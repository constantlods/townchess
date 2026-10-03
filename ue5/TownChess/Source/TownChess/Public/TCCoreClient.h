#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "TCProtocol.h"
#include "TCCoreClient.generated.h"

class IWebSocket;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FTCOnState, const FTCGameState&, State, const FString&, Reason);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FTCOnText, const FString&, Text);

UENUM(BlueprintType)
enum class ETCConnection : uint8 { Disconnected, Connecting, Connected, Welcomed };

/**
 * TownChess protocol client (protocol v2, docs/NETWORKING.md). Presentation-side only: it forwards requests and
 * reflects authoritative state. It never evaluates chess rules.
 *
 * - Identity: the token from WELCOME is stored per server (Saved/TownChess/token-<hash>.txt) and replayed on every
 *   (re)connect, so a restarted client resumes its seat.
 * - Reconnect: on any unexpected close it retries with backoff, re-authenticates and rejoins the active game; the
 *   board is rebuilt from the authoritative state it receives (GAME_JOINED).
 */
UCLASS()
class TOWNCHESS_API UTCCoreClient : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Connect to a core (`ws://host:port/ws`). `Secret` is required by a local core (sidecar), empty for servers. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void Connect(const FString& Url, const FString& Secret = TEXT(""), const FString& Username = TEXT(""));
	UFUNCTION(BlueprintCallable, Category = "TownChess") void Disconnect();

	// ── requests (the core decides; nothing here changes local game state) ──
	UFUNCTION(BlueprintCallable, Category = "TownChess") void CreateAiGame(const FString& Level, const FString& Color, const FString& TimeControl);
	UFUNCTION(BlueprintCallable, Category = "TownChess") void CreatePrivate(const FString& TimeControl);
	UFUNCTION(BlueprintCallable, Category = "TownChess") void JoinGame(const FString& GameId);
	UFUNCTION(BlueprintCallable, Category = "TownChess") void FindMatch(const FString& TimeControl, bool bRated);
	/** Sends a MOVE request. Returns the request seq; the board animates only when the core accepts it. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") int32 SubmitMove(const FString& From, const FString& To, const FString& Promotion = TEXT(""));
	UFUNCTION(BlueprintCallable, Category = "TownChess") void Resign();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void OfferDraw();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void AcceptDraw();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void DeclineDraw();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void ClaimDraw();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void Rematch();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void LeaveGame();

	// ── state ──
	UFUNCTION(BlueprintPure, Category = "TownChess") const FTCGameState& GetState() const { return State; }
	UFUNCTION(BlueprintPure, Category = "TownChess") bool HasGame() const { return !State.Id.IsEmpty(); }
	/** "w" or "b" (empty when not seated). */
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetMyColor() const { return MyColor; }
	UFUNCTION(BlueprintPure, Category = "TownChess") ETCConnection GetConnection() const { return Connection; }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetPlayerId() const { return PlayerId; }
	/** Clock for display, extrapolated since the last authoritative sample. */
	UFUNCTION(BlueprintPure, Category = "TownChess") double GetDisplayClockMs(const FString& Color) const;
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsMyTurn() const { return State.IsActive() && State.Turn == MyColor; }
	UFUNCTION(BlueprintPure, Category = "TownChess") int32 GetRejectedCount() const { return RejectedCount; }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetLastRejection() const { return LastRejection; }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetLastError() const { return LastError; }
	UFUNCTION(BlueprintPure, Category = "TownChess") int32 GetReconnectCount() const { return ReconnectCount; }

	/** Every authoritative state (joined, updated, rejected-with-state). Reason: "joined", "move", "rejected", ... */
	UPROPERTY(BlueprintAssignable) FTCOnState OnState;
	/** A move request was rejected: the board must not change. */
	UPROPERTY(BlueprintAssignable) FTCOnText OnMoveRejected;
	UPROPERTY(BlueprintAssignable) FTCOnText OnError;
	UPROPERTY(BlueprintAssignable) FTCOnText OnConnectionChanged;

private:
	void Open();
	void Send(const TSharedRef<class FJsonObject>& Msg);
	void SendGame(const TCHAR* Type);
	void HandleMessage(const FString& Text);
	void HandleClosed(const FString& Why);
	bool TickReconnect(float Dt);
	void SetConnection(ETCConnection C);
	FString TokenPath() const;
	void ApplyState(const FTCGameState& S, const FString& Reason);

	TSharedPtr<IWebSocket> Socket;
	FString Url, Secret, Username, Token, PlayerId, MyColor;
	FTCGameState State;
	double StateReceivedAt = 0;
	int32 NextSeq = 1;
	int32 RejectedCount = 0;
	int32 ReconnectCount = 0;
	FString LastRejection, LastError;
	ETCConnection Connection = ETCConnection::Disconnected;
	bool bWantConnected = false;
	double ReconnectAt = 0;
	float Backoff = 0.5f;
	FTSTicker::FDelegateHandle TickHandle;
};
