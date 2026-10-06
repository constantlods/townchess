#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformProcess.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "TCLocalCore.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FTCOnCoreReady, const FString&, Url);

/**
 * Launches and supervises the local TownChess core (the same TypeScript game core the online server runs) for
 * offline play. Contract with the core: packages/server/src/sidecar.ts and docs/NETWORKING.md "Local core".
 *
 * - Ephemeral port: the core binds 127.0.0.1:0 and reports `TOWNCHESS_CORE_READY {"port":N,...}` on stdout.
 * - Per-launch secret: random, written as the first line of the child's stdin (never in an environment block or on a
 *   command line), required on every connection.
 * - No orphans: the core exits when its stdin pipe closes, which happens whenever this process dies; on Windows the
 *   core is additionally placed in a Job Object with KILL_ON_JOB_CLOSE.
 * - Crash recovery: if the core dies while we are running, it is restarted with the same data directory; it restores
 *   unfinished games from its journal and UTCCoreClient reconnects and rejoins.
 * - Logs: everything the core prints is forwarded to LogTownChessCore, interleaved with the client log.
 *
 * Paths (highest precedence first): -tccorenode= / -tccorescript= on the command line, TOWNCHESS_NODE /
 * TOWNCHESS_CORE_SCRIPT env, the bundled core in packaged builds (Content/TownChessCore), then
 * [/Script/TownChess.TCLocalCore] NodePath / ScriptPath in DefaultGame.ini.
 */
UCLASS(Config = Game)
class TOWNCHESS_API UTCLocalCore : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Start the core (no-op if running). OnReady fires with the ws:// URL once it reports ready. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") bool Start();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void Stop();
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsReady() const { return Port > 0; }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetUrl() const { return Port > 0 ? FString::Printf(TEXT("ws://127.0.0.1:%d/ws"), Port) : FString(); }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetSecret() const { return Secret; }
	UFUNCTION(BlueprintPure, Category = "TownChess") int32 GetCorePid() const { return int32(Pid); }
	UFUNCTION(BlueprintPure, Category = "TownChess") int32 GetRestartCount() const { return Restarts; }

	UPROPERTY(BlueprintAssignable) FTCOnCoreReady OnReady;

	/** Node executable (absolute, or a name resolved via PATH). */
	UPROPERTY(Config) FString NodePath = TEXT("node");
	/** Core entry script; relative paths are resolved against the project directory. */
	UPROPERTY(Config) FString ScriptPath;
	/** Extra args before the script. @PROJECTDIRURL@ expands to the project directory as a file:// URL (dev builds run
	 *  the TypeScript sources through the repo's tsx loader). */
	UPROPERTY(Config) FString NodeArgs;

private:
	bool Tick(float Dt);
	void Launch();
	void Cleanup();
	void HandleLine(const FString& Line);

	FProcHandle Proc;
	uint32 Pid = 0;
	void* StdoutRead = nullptr;
	void* StdoutWrite = nullptr;
	void* StdinRead = nullptr;
	void* StdinWrite = nullptr;
	void* Job = nullptr;
	FString Secret;
	FString Pending;
	int32 Port = 0;
	int32 Restarts = 0;
	int32 QuickFailures = 0;
	double RetryAt = 0;
	bool bWanted = false;
	double LaunchedAt = 0;
	FTSTicker::FDelegateHandle TickHandle;
};
