#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TCProtocol.h"
#include "TCBoard.generated.h"

class UStaticMesh;
class UStaticMeshComponent;
class UMaterialInstanceDynamic;
class UTCCoreClient;

UENUM(BlueprintType)
enum class ETCClickResult : uint8 { Ignored, Selected, Deselected, Submitted, NeedsPromotion };

/** One physical piece on (or beside) the board. */
USTRUCT()
struct FTCPieceVisual
{
	GENERATED_BODY()
	UPROPERTY() TObjectPtr<USceneComponent> Root = nullptr;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Mesh = nullptr;
	FString Code; // "wp", "bk", ...
};

/**
 * The physical chessboard. Pure presentation:
 * - layout comes from the authoritative FEN (rebuilt on join/reconnect/resync);
 * - a move is animated only after the core accepted it, from that move's `effects` (castling rook, en passant
 *   victim, promotion swap arrive explicitly; nothing is inferred);
 * - after every animation the layout is checked against the FEN and rebuilt if it ever diverged;
 * - move hints come only from the core's `legalMoves`;
 * - a rejected request changes nothing on the board.
 *
 * Local space: X runs from rank 1 (-X) to rank 8 (+X), Y from the a-file (-Y) to the h-file (+Y). White sits at -X.
 */
UCLASS()
class TOWNCHESS_API ATCBoard : public AActor
{
	GENERATED_BODY()

public:
	ATCBoard();

	/** Piece meshes keyed "wp","wn","wb","wr","wq","wk","bp",...; set by the level build script. */
	UPROPERTY(EditAnywhere, Category = "TownChess") TMap<FString, TObjectPtr<UStaticMesh>> PieceMeshes;
	UPROPERTY(EditAnywhere, Category = "TownChess") TObjectPtr<UStaticMesh> BoardMesh;
	/** Rotation of the board mesh so a1 is a dark square (0/90/180/270). */
	UPROPERTY(EditAnywhere, Category = "TownChess") float BoardMeshYaw = 0.f;
	UPROPERTY(EditAnywhere, Category = "TownChess") float SquareSize = 5.8f;
	/** Yaw of each colour's pieces (knights face the opponent). */
	UPROPERTY(EditAnywhere, Category = "TownChess") float WhitePieceYaw = 0.f;
	UPROPERTY(EditAnywhere, Category = "TownChess") float BlackPieceYaw = 180.f;
	UPROPERTY(EditAnywhere, Category = "TownChess") float MoveSeconds = 0.55f;
	UPROPERTY(EditAnywhere, Category = "TownChess") float LiftHeight = 6.f;

	/** Board interaction (mouse or automation). Never moves a piece itself; it can only send a request. */
	UFUNCTION(BlueprintCallable, Category = "TownChess") ETCClickResult ClickSquare(const FString& Square);
	/** Complete a pending promotion choice ('q','r','b','n'). */
	UFUNCTION(BlueprintCallable, Category = "TownChess") bool ChoosePromotion(const FString& Piece);
	UFUNCTION(BlueprintCallable, Category = "TownChess") void ClearSelection();
	/** World point -> square ("" if off the board). */
	UFUNCTION(BlueprintPure, Category = "TownChess") FString SquareAtWorld(const FVector& World) const;
	UFUNCTION(BlueprintPure, Category = "TownChess") FVector SquareWorld(const FString& Square) const;
	/** Height of the playing surface in world space. */
	UFUNCTION(BlueprintPure, Category = "TownChess") float SurfaceZ() const;

	/** Presentation state, for automation and the HUD. */
	UFUNCTION(BlueprintPure, Category = "TownChess") FString GetSelected() const { return Selected; }
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsAnimating() const { return Anims.Num() > 0; }
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsAwaitingCore() const { return PendingRequest; }
	UFUNCTION(BlueprintPure, Category = "TownChess") bool HasPendingPromotion() const { return !PromotionFrom.IsEmpty(); }
	/** Board layout as currently shown: square -> code. */
	UFUNCTION(BlueprintPure, Category = "TownChess") TMap<FString, FString> GetShownLayout() const;
	/** True when the shown layout equals the authoritative FEN. */
	UFUNCTION(BlueprintPure, Category = "TownChess") bool IsInSync() const;
	UFUNCTION(BlueprintPure, Category = "TownChess") int32 GetAnimatedMoves() const { return AnimatedMoves; }
	UFUNCTION(BlueprintPure, Category = "TownChess") int32 GetResyncs() const { return Resyncs; }
	UFUNCTION(BlueprintPure, Category = "TownChess") TArray<FString> GetMarkedSquares() const;

	virtual void Tick(float Dt) override;

protected:
	virtual void BeginPlay() override;

private:
	UFUNCTION() void OnCoreState(const FTCGameState& State, const FString& Reason);
	UFUNCTION() void OnCoreRejected(const FString& Reason);

	void Rebuild(const FTCGameState& State);
	void AnimateMove(const FTCMoveRecord& Move);
	FTCPieceVisual SpawnPiece(const FString& Code, const FVector& Local);
	void SetPieceMesh(FTCPieceVisual& P, const FString& Code);
	static void DestroyPiece(FTCPieceVisual& P);
	FVector LocalOf(const FString& Square) const;
	FVector GraveyardSlot(const FString& CapturedColor);
	void RefreshMarkers();
	UStaticMeshComponent* AddMarker(const FVector& Local, const FLinearColor& Color, float Radius, float Height);
	UTCCoreClient* Core() const;

	UPROPERTY() TObjectPtr<USceneComponent> Root;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> BoardComp;
	UPROPERTY() TMap<FString, FTCPieceVisual> Pieces;
	UPROPERTY() TArray<FTCPieceVisual> Captured;
	UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Markers;
	/** Held as properties so garbage collection can never free them while no marker happens to reference them. */
	UPROPERTY() TObjectPtr<UStaticMesh> MarkerMesh;
	UPROPERTY() TObjectPtr<UMaterialInterface> MarkerMaterial;

	struct FAnim
	{
		TWeakObjectPtr<USceneComponent> Target;
		FVector From, To;
		float T = 0.f, Duration = 0.5f, Lift = 6.f;
		FString PromoteSquare, PromoteCode;
	};
	TArray<FAnim> Anims;
	FTCGameState Shown;
	FString Selected, PromotionFrom, PromotionTo;
	bool PendingRequest = false;
	int32 WhiteCaptured = 0, BlackCaptured = 0;
	int32 AnimatedMoves = 0, Resyncs = 0;
};
