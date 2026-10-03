#include "TCProtocol.h"

#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace
{
	FString Str(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		FString V;
		return O.IsValid() && O->TryGetStringField(Key, V) ? V : FString();
	}

	double Num(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, double Default = 0)
	{
		double V;
		return O.IsValid() && O->TryGetNumberField(Key, V) ? V : Default;
	}

	FTCPlayer ParsePlayer(const TSharedPtr<FJsonObject>& O)
	{
		FTCPlayer P;
		if (!O.IsValid()) return P;
		P.Id = Str(O, TEXT("id"));
		P.Username = Str(O, TEXT("username"));
		double R;
		P.Rating = O->TryGetNumberField(TEXT("rating"), R) ? FMath::RoundToInt32(R) : -1;
		const TSharedPtr<FJsonObject>* Ai;
		if (O->TryGetObjectField(TEXT("ai"), Ai)) P.AiLevel = Str(*Ai, TEXT("level"));
		return P;
	}

	FTCMoveRecord ParseMove(const TSharedPtr<FJsonObject>& O)
	{
		FTCMoveRecord M;
		M.From = Str(O, TEXT("from"));
		M.To = Str(O, TEXT("to"));
		M.Promotion = Str(O, TEXT("promotion"));
		M.San = Str(O, TEXT("san"));
		M.Color = Str(O, TEXT("color"));
		M.FenAfter = Str(O, TEXT("fenAfter"));
		const TArray<TSharedPtr<FJsonValue>>* Effects;
		if (O->TryGetArrayField(TEXT("effects"), Effects))
		{
			for (const TSharedPtr<FJsonValue>& V : *Effects)
			{
				const TSharedPtr<FJsonObject> E = V->AsObject();
				FTCMoveEffect Fx;
				const FString Kind = Str(E, TEXT("kind"));
				Fx.Color = Str(E, TEXT("color"));
				if (Kind == TEXT("capture")) { Fx.Kind = ETCEffectKind::Capture; Fx.From = Str(E, TEXT("square")); Fx.Piece = Str(E, TEXT("piece")); }
				else if (Kind == TEXT("promote")) { Fx.Kind = ETCEffectKind::Promote; Fx.From = Str(E, TEXT("square")); Fx.Piece = Str(E, TEXT("to")); }
				else { Fx.Kind = ETCEffectKind::Move; Fx.From = Str(E, TEXT("from")); Fx.To = Str(E, TEXT("to")); Fx.Piece = Str(E, TEXT("piece")); }
				M.Effects.Add(Fx);
			}
		}
		return M;
	}
}

bool TCProtocol::ParseState(const TSharedPtr<FJsonObject>& O, FTCGameState& S)
{
	if (!O.IsValid()) return false;
	S = FTCGameState();
	S.Id = Str(O, TEXT("id"));
	const TSharedPtr<FJsonObject>* P;
	if (O->TryGetObjectField(TEXT("white"), P)) S.White = ParsePlayer(*P);
	if (O->TryGetObjectField(TEXT("black"), P)) S.Black = ParsePlayer(*P);
	S.Fen = Str(O, TEXT("fen"));
	S.Turn = Str(O, TEXT("turn"));
	S.WhiteClockMs = Num(O, TEXT("whiteClockMs"));
	S.BlackClockMs = Num(O, TEXT("blackClockMs"));
	const TSharedPtr<FJsonObject>* Tc;
	if (O->TryGetObjectField(TEXT("timeControl"), Tc)) S.InitialMs = Num(*Tc, TEXT("initialMs"));
	S.Status = Str(O, TEXT("status"));
	S.Winner = Str(O, TEXT("winner"));
	S.Termination = Str(O, TEXT("termination"));
	O->TryGetBoolField(TEXT("rated"), S.bRated);
	S.DrawOfferBy = Str(O, TEXT("drawOfferBy"));
	S.RematchOfferBy = Str(O, TEXT("rematchOfferBy"));
	S.DrawPolicy = Str(O, TEXT("drawPolicy"));
	S.ClaimableDraw = Str(O, TEXT("claimableDraw"));
	S.EventSeq = FMath::RoundToInt32(Num(O, TEXT("eventSeq")));
	const TArray<TSharedPtr<FJsonValue>>* Arr;
	if (O->TryGetArrayField(TEXT("moveHistory"), Arr)) for (const TSharedPtr<FJsonValue>& V : *Arr) S.History.Add(ParseMove(V->AsObject()));
	if (O->TryGetArrayField(TEXT("legalMoves"), Arr)) for (const TSharedPtr<FJsonValue>& V : *Arr) S.LegalMoves.Add(V->AsString());
	if (O->TryGetArrayField(TEXT("disconnected"), Arr)) for (const TSharedPtr<FJsonValue>& V : *Arr) S.Disconnected.Add(V->AsString());
	if (O->TryGetArrayField(TEXT("lastEvents"), Arr))
	{
		for (const TSharedPtr<FJsonValue>& V : *Arr)
		{
			const TSharedPtr<FJsonObject> E = V->AsObject();
			FTCGameEvent Ev;
			Ev.Type = Str(E, TEXT("type"));
			Ev.Ply = FMath::RoundToInt32(Num(E, TEXT("ply")));
			Ev.Color = Str(E, TEXT("color"));
			Ev.San = Str(E, TEXT("san"));
			S.LastEvents.Add(Ev);
		}
	}
	const TSharedPtr<FJsonObject>* Op;
	if (O->TryGetObjectField(TEXT("opening"), Op)) { S.OpeningName = Str(*Op, TEXT("name")); S.OpeningEco = Str(*Op, TEXT("eco")); }
	return !S.Id.IsEmpty() && !S.Fen.IsEmpty();
}

TMap<FString, FString> FTCGameState::PiecesFromFen() const
{
	TMap<FString, FString> Out;
	FString Placement;
	if (!Fen.Split(TEXT(" "), &Placement, nullptr)) Placement = Fen;
	int32 Rank = 7, File = 0;
	for (const TCHAR Ch : Placement)
	{
		if (Ch == '/') { --Rank; File = 0; continue; }
		if (FChar::IsDigit(Ch)) { File += Ch - '0'; continue; }
		const bool bWhite = FChar::IsUpper(Ch);
		Out.Add(TCProtocol::FileRankToSquare(File, Rank), FString::Printf(TEXT("%c%c"), bWhite ? 'w' : 'b', FChar::ToLower(Ch)));
		++File;
	}
	return Out;
}

FString TCProtocol::ToJson(const TSharedRef<FJsonObject>& Obj)
{
	FString Out;
	const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> W = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
	FJsonSerializer::Serialize(Obj, W);
	return Out;
}

TSharedPtr<FJsonObject> TCProtocol::FromJson(const FString& Text)
{
	TSharedPtr<FJsonObject> Obj;
	const TSharedRef<TJsonReader<>> R = TJsonReaderFactory<>::Create(Text);
	return FJsonSerializer::Deserialize(R, Obj) ? Obj : nullptr;
}

bool TCProtocol::SquareToFileRank(const FString& Square, int32& File, int32& Rank)
{
	if (Square.Len() != 2) return false;
	File = Square[0] - 'a';
	Rank = Square[1] - '1';
	return File >= 0 && File < 8 && Rank >= 0 && Rank < 8;
}

FString TCProtocol::FileRankToSquare(int32 File, int32 Rank)
{
	return FString::Printf(TEXT("%c%c"), 'a' + File, '1' + Rank);
}
