#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/PlayerController.h"
#include "TCProtocol.h"
#include "TCGame.generated.h"

class ATCBoard;
class UTCCoreClient;
class UFont;
class UTextureRenderTarget2D;

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
	/** The player's hands (the reference's HAND CUSTOMIZATION): "bare", "sleeves", "watch" or "sleeves+watch". Shows the
	 *  level's TC_PlayerOpt_<option> actors that the look names; remembered in GameUserSettings; -tclook= overrides. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void ApplyPlayerLook(const FString& Look);
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetPlayerLook() const { return PlayerLook; }
	/** Settings panel: graphics preset ("auto", "medium", "high", "epic") and master volume 0..1, both remembered. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void SetQuality(const FString& Choice);
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetQuality() const { return Quality; }
	UFUNCTION(BlueprintCallable, Category = "TownChess") void SetVolume(float V);
	UFUNCTION(BlueprintPure, Category = "TownChess") float GetVolume() const { return Volume; }
	virtual void Tick(float Dt) override;

private:
	UFUNCTION() void OnCoreReady(const FString& Url);
	UFUNCTION() void OnConnection(const FString& State);
	void TryAutoStart();
	UFUNCTION() void OnState(const FTCGameState& State, const FString& Reason);
	void ApplySeat(const FString& Color);
	void ApplyQualityPreset();

	FString ServerUrl, Auto, Username, SeatApplied, OpponentShown;
	FString PlayerLook = TEXT("bare");
	FString Quality = TEXT("auto");
	float Volume = 0.8f;
	UPROPERTY(Transient) TObjectPtr<class UAudioComponent> Ambience;
	UPROPERTY(Transient) TObjectPtr<class USoundBase> Sting;
	bool bSawActive = false, bSawFinish = false;
	TArray<double> FrameTimes;
	FString ActiveId;
	int32 SmokePlies = 0, SmokeChecked = -1, SmokeFailures = 0;
	FString SmokeGameId;
	bool bSmokeResigned = false;
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
	UPROPERTY(BlueprintReadOnly, Category = "TownChess") FString JoinCode;
	UPROPERTY(BlueprintReadOnly, Category = "TownChess") bool bTypingCode = false;
	/** Seat view height 0..1 (mouse wheel, settings panel). */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void SetViewHeight(float V);
	UFUNCTION(BlueprintPure, Category = "TownChess") float GetViewHeight() const { return ViewHeight; }
	/** Autotest hook: feeds a key (by name: "Tab", "A", "BackSpace", "Escape", "Q") through the same handler as the keyboard. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void PressKeyForTest(FName KeyName) { OnKey(FKey(KeyName)); }
private:
	void OnClick();
	void OnRelease();
	void ViewUp() { SetViewHeight(ViewHeight + 0.1f); }
	void ViewDown() { SetViewHeight(ViewHeight - 0.1f); }
	virtual void PlayerTick(float Dt) override;
	bool PointerOnBoard(FString& Square, FVector& World) const;
	void OnKey(FKey Key);
	UFUNCTION() void OnState(const FTCGameState& State, const FString& Reason);
	FString CameraFor;
	/** Seat view height, 0 = low over the table (the reference's angle) .. 1 = higher, looking down onto the board so
	 *  no piece hides behind another. Mouse wheel; remembered in GameUserSettings; -tcview=<0..1> for screenshots. */
	void ApplyView(float Dt);
	float ViewHeight = 0.6f;
	float ViewShown = -1.f;
	TWeakObjectPtr<AActor> ViewCam;
	FVector ViewBaseLoc = FVector::ZeroVector;
	FRotator ViewBaseRot = FRotator::ZeroRotator;
	float ViewBaseFocal = 0.f;
};

/** Minimal in-world HUD (canvas): menu, player plates, clocks, status, actions, promotion picker. */
/** HUD fonts: the reference pairs a clean sans (play) with thin monospace capitals (section titles). */
enum class ETCUiFont : uint8 { Sans, SansLight, Title };
/** HUD button looks: quiet text row, bordered option, filled primary action. */
enum class ETCButton : uint8 { Plain, Boxed, Primary };

UCLASS()
class TOWNCHESS_API ATCHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
	/** Draws the HUD over an existing render target (reference screenshots: capture.py -TCHud=1). */
	UFUNCTION(BlueprintCallable, Category = "TownChess") void DrawToRenderTarget(UTextureRenderTarget2D* Target);
	/** Returns true if the click hit a HUD button (and performed it). */
	bool HandleClick(const FVector2D& Pos);
	UFUNCTION(BlueprintCallable, Category = "TownChess") void PressButton(const FString& Id);
	UFUNCTION(BlueprintPure, Category = "TownChess") TArray<FString> GetVisibleButtons() const;

	FString Level = TEXT("patient");
	FString TimeControl = TEXT("5+0");
	FString Toast;
	double ToastUntil = 0;
	bool bConfirmResign = false;
	bool bShowSettings = false;
	void DrawSettings();
	/** Accessibility: also print the opening on screen (the clipboard is the default home of the game record). */
	bool bScreenRecord = false;
	static FString OpponentName(const FString& Id);
	static FString LookName(const FString& Look);

private:
	struct FButton { FString Id; FString Label; FVector2D Pos, Size; };
	TArray<FButton> Buttons;
	void Button(const FString& Id, const FString& Label, float X, float Y, float W = 260.f, ETCButton Style = ETCButton::Plain);
	void Plate(float X, float Y, float W, float H, float Alpha, float BorderAlpha, const FLinearColor& Fill = FLinearColor(0.012f, 0.011f, 0.01f));
	bool Hovered(float X, float Y, float W, float H) const;
	UFont* UiFont(ETCUiFont Which = ETCUiFont::Sans);
	float TextWidth(const FString& S, float Scale, ETCUiFont Which = ETCUiFont::Sans);
	float Ui() const;
	UPROPERTY(Transient) TArray<TObjectPtr<UFont>> Fonts;
	void Text(const FString& S, float X, float Y, const FLinearColor& C, float Scale = 1.f, bool bCenter = false, ETCUiFont Which = ETCUiFont::Sans);
	void DrawUi();
	void DrawMenu(UTCCoreClient* C);
	void DrawGame(UTCCoreClient* C);
	UFUNCTION() void OnRejected(const FString& Reason);
	UFUNCTION() void OnError(const FString& Message);
	bool bBound = false;
};
