#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/PlayerController.h"
#include "TCProtocol.h"
#include "TCGame.generated.h"

class ATCBoard;
class UTCCoreClient;

/**
 * Startup and seat handling.
 * - Offline (default): starts the local core (UTCLocalCore) and connects to it.
 * - Online: `-tcserver=ws://host:port/ws` connects to a TownChess server instead.
 * - `-tcauto=cpu:<level>:<w|b|random>:<tc>` creates an engine game as soon as the session is up (demos, automation).
 * - `-tcname=<username>` sets the requested username.
 * - `-tcopponent=<id>` picks the opponent from the level's roster (caged, annotator; default caged).
 * - `-tcsmoke=<plies>` (packaged-build smoke test, no Python needed): plays that many plies against the engine
 *   through the board's click path, checks every position (in sync, no silent repair, no misplaced piece), writes
 *   Saved/TownChess/smoke.json and quits.
 * Actors tagged `TC_SeatMirror` (opponent, chair, player hands, lamp) are mirrored to the other side of the table when
 * the player sits as Black; cameras tagged `TC_Camera_White` / `TC_Camera_Black` frame each seat.
 */
UCLASS()
class TOWNCHESS_API ATCGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ATCGameMode();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsOnline() const { return !ServerUrl.IsEmpty(); }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetServerLabel() const;
	/** Show one opponent from the level's roster (tags TC_Opponent_<id>) and hide the others. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void ApplyOpponent(const FString& Id);
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetOpponent() const { return OpponentShown; }
	virtual void Tick(float Dt) override;

private:
	UFUNCTION() void OnCoreReady(const FString& Url);
	UFUNCTION() void OnConnection(const FString& State);
	UFUNCTION() void OnState(const FTCGameState& State, const FString& Reason);
	void ApplySeat(const FString& Color);

	FString ServerUrl, Auto, Username, SeatApplied, OpponentShown;
	int32 SmokePlies = 0, SmokeChecked = -1, SmokeFailures = 0;
	double SmokeDeadline = 0;
	TArray<FString> SmokeLog;
	void SmokeTick();
	void SmokeFinish(const FString& Why);
	bool bAutoDone = false;
	TMap<TWeakObjectPtr<AActor>, FTransform> SeatOriginals;
};

UCLASS()
class TOWNCHESS_API ATCPlayerController : public APlayerController
{
	GENERATED_BODY()
public:
	ATCPlayerController();
	virtual void SetupInputComponent() override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	ATCBoard* Board() const;
	UTCCoreClient* Core() const;
	/** Text entry for the "join table" code on the menu. */
	FString JoinCode;
	bool bTypingCode = false;
private:
	void OnClick();
	void OnKey(FKey Key);
	UFUNCTION() void OnState(const FTCGameState& State, const FString& Reason);
	FString CameraFor;
};

/** Minimal in-world HUD (canvas): menu, player plates, clocks, status, actions, promotion picker. */
UCLASS()
class TOWNCHESS_API ATCHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
	/** Returns true if the click hit a HUD button (and performed it). */
	bool HandleClick(const FVector2D& Pos);
	UFUNCTION(BlueprintCallable, Category = "TownChess") void PressButton(const FString& Id);
	UFUNCTION(BlueprintPure, Category = "TownChess") TArray<FString> GetVisibleButtons() const;

	FString Level = TEXT("patient");
	FString TimeControl = TEXT("5+0");
	FString Toast;
	double ToastUntil = 0;
	bool bConfirmResign = false;
	static FString OpponentName(const FString& Id);

private:
	struct FButton { FString Id; FString Label; FVector2D Pos, Size; };
	TArray<FButton> Buttons;
	void Button(const FString& Id, const FString& Label, float X, float Y, float W = 260.f);
	void Text(const FString& S, float X, float Y, const FLinearColor& C, float Scale = 1.f, bool bCenter = false);
	void DrawMenu(UTCCoreClient* C);
	void DrawGame(UTCCoreClient* C);
	UFUNCTION() void OnRejected(const FString& Reason);
	UFUNCTION() void OnError(const FString& Message);
	bool bBound = false;
};
