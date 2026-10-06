#pragma once

#include "CoreMinimal.h"
#include "TCProtocol.generated.h"

class FJsonObject;

/**
 * Wire types of the TownChess protocol v2 (JSON Schema in docs/protocol, docs/NETWORKING.md).
 * These are plain data mirrors of what the core sends. The client never computes chess rules from them: legal moves,
 * move effects, status and results all arrive from the core.
 */

UENUM(BlueprintType)
enum class ETCEffectKind : uint8 { Move, Capture, Promote };

USTRUCT(BlueprintType)
struct TOWNCHESS_API FTCMoveEffect
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly) ETCEffectKind Kind = ETCEffectKind::Move;
	/** 'p','n','b','r','q','k' (for Promote: the new piece). */
	UPROPERTY(BlueprintReadOnly) FString Piece;
	/** 'w' or 'b' */
	UPROPERTY(BlueprintReadOnly) FString Color;
	/** Move: origin; Capture/Promote: the square concerned. */
	UPROPERTY(BlueprintReadOnly) FString From;
	/** Move only. */
	UPROPERTY(BlueprintReadOnly) FString To;
};

USTRUCT(BlueprintType)
struct TOWNCHESS_API FTCMoveRecord
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly) FString From;
	UPROPERTY(BlueprintReadOnly) FString To;
	UPROPERTY(BlueprintReadOnly) FString Promotion;
	UPROPERTY(BlueprintReadOnly) FString San;
	UPROPERTY(BlueprintReadOnly) FString Color;
	UPROPERTY(BlueprintReadOnly) FString FenAfter;
	UPROPERTY(BlueprintReadOnly) TArray<FTCMoveEffect> Effects;
};

USTRUCT(BlueprintType)
struct TOWNCHESS_API FTCPlayer
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly) FString Id;
	UPROPERTY(BlueprintReadOnly) FString Username;
	/** -1 when the core sends null (engine seats are unrated). */
	UPROPERTY(BlueprintReadOnly) int32 Rating = -1;
	UPROPERTY(BlueprintReadOnly) FString AiLevel;
	bool IsValid() const { return !Id.IsEmpty(); }
};

USTRUCT(BlueprintType)
struct TOWNCHESS_API FTCGameEvent
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly) FString Type;
	UPROPERTY(BlueprintReadOnly) int32 Ply = 0;
	UPROPERTY(BlueprintReadOnly) FString Color;
	UPROPERTY(BlueprintReadOnly) FString San;
};

USTRUCT(BlueprintType)
struct TOWNCHESS_API FTCGameState
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly) FString Id;
	UPROPERTY(BlueprintReadOnly) FTCPlayer White;
	UPROPERTY(BlueprintReadOnly) FTCPlayer Black;
	UPROPERTY(BlueprintReadOnly) FString Fen;
	UPROPERTY(BlueprintReadOnly) TArray<FTCMoveRecord> History;
	UPROPERTY(BlueprintReadOnly) FString Turn;
	UPROPERTY(BlueprintReadOnly) double WhiteClockMs = 0;
	UPROPERTY(BlueprintReadOnly) double BlackClockMs = 0;
	UPROPERTY(BlueprintReadOnly) double InitialMs = 0;
	/** Whose clock is running ("w"/"b"), empty when none is (before both first moves, untimed, game over). */
	UPROPERTY(BlueprintReadOnly) FString ClockRunning;
	UPROPERTY(BlueprintReadOnly) FString Status;
	UPROPERTY(BlueprintReadOnly) FString Winner;
	UPROPERTY(BlueprintReadOnly) FString Termination;
	UPROPERTY(BlueprintReadOnly) bool bRated = false;
	UPROPERTY(BlueprintReadOnly) FString DrawOfferBy;
	UPROPERTY(BlueprintReadOnly) FString RematchOfferBy;
	UPROPERTY(BlueprintReadOnly) FString DrawPolicy;
	UPROPERTY(BlueprintReadOnly) FString ClaimableDraw;
	/** UCI moves for the side to move ("e2e4", "e7e8q"): the only source of move hints. */
	UPROPERTY(BlueprintReadOnly) TArray<FString> LegalMoves;
	UPROPERTY(BlueprintReadOnly) FString OpeningName;
	UPROPERTY(BlueprintReadOnly) FString OpeningEco;
	UPROPERTY(BlueprintReadOnly) TArray<FTCGameEvent> LastEvents;
	UPROPERTY(BlueprintReadOnly) int32 EventSeq = 0;
	UPROPERTY(BlueprintReadOnly) TArray<FString> Disconnected;
	/** Untimed games report initialMs 0. */
	bool IsTimed() const { return InitialMs > 0; }
	bool IsActive() const { return Status == TEXT("active"); }
	bool IsFinished() const { return !Status.IsEmpty() && Status != TEXT("active") && Status != TEXT("waiting"); }
	/** Board placement from the FEN: square -> "wp", "bk", ... */
	TMap<FString, FString> PiecesFromFen() const;
};

namespace TCProtocol
{
	TOWNCHESS_API bool ParseState(const TSharedPtr<FJsonObject>& Obj, FTCGameState& Out);
	TOWNCHESS_API FString ToJson(const TSharedRef<FJsonObject>& Obj);
	TOWNCHESS_API TSharedPtr<FJsonObject> FromJson(const FString& Text);
	/** "e2" -> (4,1); false if malformed. */
	TOWNCHESS_API bool SquareToFileRank(const FString& Square, int32& File, int32& Rank);
	TOWNCHESS_API FString FileRankToSquare(int32 File, int32 Rank);
}
