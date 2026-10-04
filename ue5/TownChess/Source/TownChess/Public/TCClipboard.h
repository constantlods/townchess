#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TCProtocol.h"
#include "TCClipboard.generated.h"

class UCanvas;
class UCanvasRenderTarget2D;
class UFont;
class UFontFace;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class UPointLightComponent;
class UStaticMeshComponent;

/**
 * The game record on an asylum clipboard (docs/CLIPBOARD_CRITIQUE.md). It rests on the medical cart beside the table;
 * Toggle() (Tab) lifts it into a camera-relative reading pose, pulls the camera's focus onto it and switches on a small
 * reading light, then puts it back. The sheet ("WARD B - GAME RECORD": players, opening, moves in two columns of 15
 * rows, 60 plies per page) is drawn into a render target only when the authoritative state changes. Presentation only:
 * it shows the core's move history and opening, it never decides anything.
 */
UCLASS()
class TOWNCHESS_API ATCClipboard : public AActor
{
	GENERATED_BODY()
public:
	ATCClipboard();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float Dt) override;

	UFUNCTION(BlueprintCallable, Category = "TownChess") void Toggle();
	UFUNCTION(BlueprintCallable, Category = "TownChess") void SetRaised(bool bRaise);
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsRaised() const { return bRaised; }
	/** The lines currently written on the sheet (for tests and the accessible on-screen copy). */
	UFUNCTION(BlueprintPure, Category = "TownChess") TArray<FString> GetSheetLines() const { return SheetLines; }
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetOpeningLine() const { return OpeningLine; }

	UPROPERTY(VisibleAnywhere, Category = "TownChess") TObjectPtr<USceneComponent> Root;
	UPROPERTY(VisibleAnywhere, Category = "TownChess") TObjectPtr<UStaticMeshComponent> Board;
	UPROPERTY(VisibleAnywhere, Category = "TownChess") TObjectPtr<UStaticMeshComponent> Paper;
	UPROPERTY(VisibleAnywhere, Category = "TownChess") TObjectPtr<UPointLightComponent> ReadLight;

	/** Material with a "Sheet" texture parameter (the level builder makes M_TC_Paper). */
	UPROPERTY(EditAnywhere, Category = "TownChess") TObjectPtr<UMaterialInterface> PaperMaterial;
	/** Handwriting (moves) and form (printed headings) fonts; engine fonts are used when unset. */
	UPROPERTY(EditAnywhere, Category = "TownChess") TObjectPtr<UFont> HandFont;
	UPROPERTY(EditAnywhere, Category = "TownChess") TObjectPtr<UFont> FormFont;
	/** Font faces (imported TTFs); runtime fonts are built from them when HandFont/FormFont are unset. */
	UPROPERTY(EditAnywhere, Category = "TownChess") TObjectPtr<UFontFace> HandFace;
	UPROPERTY(EditAnywhere, Category = "TownChess") TObjectPtr<UFontFace> FormFace;
	/** Reading pose relative to the camera (cm): forward, right, up. */
	UPROPERTY(EditAnywhere, Category = "TownChess") FVector RaisedOffset = FVector(57.f, 17.f, -2.f);
	UPROPERTY(EditAnywhere, Category = "TownChess") float RaiseSeconds = 0.45f;

private:
	UFUNCTION() void OnState(const FTCGameState& State, const FString& Reason);
	UFUNCTION() void DrawSheet(UCanvas* Canvas, int32 Width, int32 Height);
	void Rebuild(const FTCGameState& State);
	FTransform RaisedTransform() const;

	UPROPERTY(Transient) TObjectPtr<UCanvasRenderTarget2D> Sheet;
	UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> PaperMID;
	TArray<FString> SheetLines;
	FString OpeningLine, WhiteName, BlackName, ResultLine;
	int32 Page = 0;
	FTransform Rest;
	bool bRaised = false;
	float Alpha = 0.f;
	float SavedFocus = -1.f;
};
