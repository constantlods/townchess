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

void UTCLocalCore::Launch()
{
	FString Node = NodePath, Script = ScriptPath, Args = NodeArgs, Env;
	if (FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_NODE")).Len()) Node = FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_NODE"));
	if (FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_CORE_SCRIPT")).Len()) Script = FPlatformMisc::GetEnvironmentVariable(TEXT("TOWNCHESS_CORE_SCRIPT"));
	FParse::Value(FCommandLine::Get(), TEXT("-tccorenode="), Node);
	FParse::Value(FCommandLine::Get(), TEXT("-tccorescript="), Script);
	FParse::Value(FCommandLine::Get(), TEXT("-tccoreargs="), Args);
	if (Script.IsEmpty()) { UE_LOG(LogTownChess, Error, TEXT("local core: no ScriptPath configured")); return; }
	if (FPaths::IsRelative(Script)) Script = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / Script);
	// Node resolves --import specifiers against its own working directory, and absolute paths must be file URLs on
	// Windows: @PROJECTDIRURL@ expands to the project directory as a file:// URL.
	FString ProjectDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir());
	ProjectDir.ReplaceInline(TEXT("\\"), TEXT("/"));
	FPaths::NormalizeDirectoryName(ProjectDir);
	const FString ProjectUrl = ProjectDir.StartsWith(TEXT("/")) ? TEXT("file://") + ProjectDir : TEXT("file:///") + ProjectDir;
	Args.ReplaceInline(TEXT("@PROJECTDIRURL@"), *ProjectUrl);

	verify(FPlatformProcess::CreatePipe(StdoutRead, StdoutWrite));
	// stdin: we keep the write end; the child exits when it closes (our process ended)
	verify(FPlatformProcess::CreatePipe(StdinRead, StdinWrite, /*bWritePipeLocal=*/true));

	// The secret reaches the child through its environment only (not visible in process listings' command lines).
	FPlatformMisc::SetEnvironmentVar(TEXT("TOWNCHESS_CORE_SECRET"), *Secret);
	const FString Data = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("TownChess") / TEXT("core"));
	FPlatformMisc::SetEnvironmentVar(TEXT("TOWNCHESS_CORE_DATA"), *Data);
	const FString Params = FString::Printf(TEXT("%s \"%s\""), *Args, *Script).TrimStart();
	Proc = FPlatformProcess::CreateProc(*Node, *Params, false, true, true, &Pid, 0, *FPaths::GetPath(Script), StdoutWrite, StdinRead);
	FPlatformMisc::SetEnvironmentVar(TEXT("TOWNCHESS_CORE_SECRET"), TEXT(""));
	if (!Proc.IsValid())
	{
		UE_LOG(LogTownChess, Error, TEXT("local core: could not start %s %s"), *Node, *Params);
		Cleanup();
		return;
	}
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
	UE_LOG(LogTownChess, Log, TEXT("local core: launched pid %u (%s %s), data %s"), Pid, *Node, *Params, *Data);
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
	if (bWanted && Proc.IsValid() && !FPlatformProcess::IsProcRunning(Proc))
	{
		int32 Code = -1;
		FPlatformProcess::GetProcReturnCode(Proc, &Code);
		UE_LOG(LogTownChess, Warning, TEXT("local core: exited unexpectedly (code %d); restarting"), Code);
		Cleanup();
		++Restarts;
		if (FPlatformTime::Seconds() - LaunchedAt > 2.0 || Restarts < 5) Launch();
		else UE_LOG(LogTownChess, Error, TEXT("local core: crash loop, giving up"));
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
