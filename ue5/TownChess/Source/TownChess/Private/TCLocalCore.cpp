#include "TCLocalCore.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"
#include "Misc/Guid.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "TCLog.h"
#include "TCProtocol.h"

#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include <windows.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

void UTCLocalCore::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UTCLocalCore::Tick), 0.05f);
}

void UTCLocalCore::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
	Stop();
	Super::Deinitialize();
}

bool UTCLocalCore::Start()
{
	bWanted = true;
	if (Proc.IsValid() && FPlatformProcess::IsProcRunning(Proc)) return true;
	// one secret per game launch; reused across core restarts so reconnecting clients keep working
	if (Secret.IsEmpty()) Secret = FGuid::NewGuid().ToString(EGuidFormats::Digits) + FGuid::NewGuid().ToString(EGuidFormats::Digits);
	Launch();
	return Proc.IsValid();
}

namespace
{
	/** Absolute path -> file:// URL with every byte outside the URL-safe set percent-encoded (spaces, '#', '%', UTF-8). */
	FString PathToFileUrl(FString Path)
	{
		Path.ReplaceInline(TEXT("\\"), TEXT("/"));
		FPaths::NormalizeDirectoryName(Path);
		FString Encoded;
		const FTCHARToUTF8 Utf8(*Path);
		for (int32 i = 0; i < Utf8.Length(); ++i)
		{
			const uint8 C = static_cast<uint8>(Utf8.Get()[i]);
			const bool bSafe = FChar::IsAlnum(C) || C == '/' || C == '-' || C == '_' || C == '.' || C == '~' || C == ':';
			Encoded += bSafe ? FString::Chr(C) : FString::Printf(TEXT("%%%02X"), C);
		}
		return Encoded.StartsWith(TEXT("/")) ? TEXT("file://") + Encoded : TEXT("file:///") + Encoded;
	}
}

void UTCLocalCore::Launch()
{
	// Precedence: command line > environment > packaged bundle > DefaultGame.ini (dev layout).
	FString Node = NodePath, Script = ScriptPath, Args = NodeArgs;
#if !WITH_EDITOR
	// Packaged game: the core ships inside the build (Content/TownChessCore: node runtime + bundled core), so a shipped
	// game needs no repository, no tsx and no system-wide Node.js.
	{
		const FString Bundled = FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir() / TEXT("TownChessCore"));
		const FString BundledScript = Bundled / TEXT("townchess-core.mjs");
		const FString BundledNode = Bundled / (PLATFORM_WINDOWS ? TEXT("node.exe") : TEXT("node"));
		if (FPaths::FileExists(BundledScript) && FPaths::FileExists(BundledNode)) { Node = BundledNode; Script = BundledScript; Args.Empty(); }
		else UE_LOG(LogTownChess, Error, TEXT("local core: bundled core missing in %s; falling back to the development layout"), *Bundled);
	}
#endif
	if (FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_NODE")).Len()) Node = FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_NODE"));
	if (FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_CORE_SCRIPT")).Len()) Script = FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_CORE_SCRIPT"));
	FParse::Value(FCommandLine::Get(), TEXT("-tccorenode="), Node);
	FParse::Value(FCommandLine::Get(), TEXT("-tccorescript="), Script);
	FParse::Value(FCommandLine::Get(), TEXT("-tccoreargs="), Args);
	if (Script.IsEmpty()) { UE_LOG(LogTownChess, Error, TEXT("local core: no ScriptPath configured")); return; }
	if (FPaths::IsRelative(Script)) Script = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / Script);
	// Node resolves --import specifiers against its own working directory and needs file URLs for absolute paths on
	// Windows: @PROJECTDIRURL@ expands to the project directory as a percent-encoded file:// URL (no spaces left).
	Args.ReplaceInline(TEXT("@PROJECTDIRURL@"), *PathToFileUrl(FPaths::ConvertRelativePathToFull(FPaths::ProjectDir())));

	verify(FPlatformProcess::CreatePipe(StdoutRead, StdoutWrite));
	// stdin: we keep the write end; the first line carries the secret, and the child exits when the pipe closes
	verify(FPlatformProcess::CreatePipe(StdinRead, StdinWrite, /*bWritePipeLocal=*/true));

	// Nothing goes through the environment (it is process-wide and inherited by every child any thread starts).
	const FString Data = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("TownChess") / TEXT("core"));
	const FString Params = FString::Printf(TEXT("%s \"%s\" --data \"%s\""), *Args, *Script, *Data).TrimStart();
	Proc = FPlatformProcess::CreateProc(*Node, *Params, false, true, true, &Pid, 0, *FPaths::GetPath(Script), StdoutWrite, StdinRead);
	if (!Proc.IsValid())
	{
		UE_LOG(LogTownChess, Error, TEXT("local core: could not start %s %s"), *Node, *Params);
		Cleanup();
		RetryAt = FPlatformTime::Seconds() + 2.0; // keep trying instead of leaving the HUD on "connecting" forever
		return;
	}
	FPlatformProcess::WritePipe(StdinWrite, Secret + TEXT("\n"));
#if PLATFORM_WINDOWS
	// Belt and braces on Windows: if this process dies for any reason, the OS kills the core with it.
	HANDLE JobHandle = CreateJobObjectW(nullptr, nullptr);
	if (JobHandle)
	{
		JOBOBJECT_EXTENDED_LIMIT_INFORMATION Info = {};
		Info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
		SetInformationJobObject(JobHandle, JobObjectExtendedLimitInformation, &Info, sizeof(Info));
		if (!AssignProcessToJobObject(JobHandle, Proc.Get())) UE_LOG(LogTownChess, Warning, TEXT("local core: AssignProcessToJobObject failed (%u)"), GetLastError());
		Job = JobHandle;
	}
#endif
	Port = 0;
	Pending.Empty();
	LaunchedAt = FPlatformTime::Seconds();
	RetryAt = 0;
	UE_LOG(LogTownChess, Log, TEXT("local core: launched pid %u (%s %s)"), Pid, *Node, *Params);
}

bool UTCLocalCore::Tick(float)
{
	if (StdoutRead)
	{
		Pending += FPlatformProcess::ReadPipe(StdoutRead);
		int32 Nl;
		while (Pending.FindChar('\n', Nl))
		{
			HandleLine(Pending.Left(Nl).TrimEnd());
			Pending.RightChopInline(Nl + 1);
		}
	}
	const double Now = FPlatformTime::Seconds();
	if (Port > 0 && QuickFailures > 0 && Now - LaunchedAt > 60.0) QuickFailures = 0; // stable again: forget old failures
	if (bWanted && Proc.IsValid() && !FPlatformProcess::IsProcRunning(Proc))
	{
		int32 Code = -1;
		FPlatformProcess::GetProcReturnCode(Proc, &Code);
		UE_LOG(LogTownChess, Warning, TEXT("local core: exited unexpectedly (code %d); restarting"), Code);
		Cleanup();
		++Restarts;
		if (Now - LaunchedAt < 5.0) ++QuickFailures;
		if (QuickFailures < 5) Launch();
		else UE_LOG(LogTownChess, Error, TEXT("local core: crash loop (5 failures within 5 s of launch), giving up"));
	}
	else if (bWanted && !Proc.IsValid() && RetryAt > 0 && Now >= RetryAt && QuickFailures < 5)
	{
		++QuickFailures;
		Launch();
	}
	return true;
}

void UTCLocalCore::HandleLine(const FString& Line)
{
	if (Line.StartsWith(TEXT("TOWNCHESS_CORE_READY ")))
	{
		const TSharedPtr<FJsonObject> Info = TCProtocol::FromJson(Line.RightChop(21));
		if (Info.IsValid())
		{
			Port = Info->GetIntegerField(TEXT("port"));
			UE_LOG(LogTownChess, Log, TEXT("local core: ready on %s (pid %u)"), *GetUrl(), Pid);
			OnReady.Broadcast(GetUrl());
		}
		return;
	}
	if (!Line.IsEmpty()) UE_LOG(LogTownChessCore, Log, TEXT("%s"), *Line);
}

void UTCLocalCore::Stop()
{
	bWanted = false;
	if (Proc.IsValid() && FPlatformProcess::IsProcRunning(Proc))
	{
		// closing stdin asks the core to shut down cleanly (flushes its journal); terminate if it lingers
		if (StdinWrite) { FPlatformProcess::ClosePipe(nullptr, StdinWrite); StdinWrite = nullptr; }
		const double Deadline = FPlatformTime::Seconds() + 3.0;
		while (FPlatformProcess::IsProcRunning(Proc) && FPlatformTime::Seconds() < Deadline) FPlatformProcess::Sleep(0.05f);
		if (FPlatformProcess::IsProcRunning(Proc)) FPlatformProcess::TerminateProc(Proc, true);
	}
	Cleanup();
}

void UTCLocalCore::Cleanup()
{
	if (Proc.IsValid()) FPlatformProcess::CloseProc(Proc);
	FPlatformProcess::ClosePipe(StdoutRead, StdoutWrite);
	FPlatformProcess::ClosePipe(StdinRead, StdinWrite);
	StdoutRead = StdoutWrite = StdinRead = StdinWrite = nullptr;
#if PLATFORM_WINDOWS
	if (Job) { CloseHandle((HANDLE)Job); Job = nullptr; }
#endif
	Port = 0;
	Pid = 0;
}
