#include "TCGame.h"

#include "Camera/CameraActor.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "TCBoard.h"
#include "TCCoreClient.h"
#include "TCLocalCore.h"
#include "TCLog.h"

namespace
{
	FString ClockText(double Ms)
	{
		const int32 Total = FMath::Max(0, FMath::CeilToInt32(Ms / 1000.0));
		return FString::Printf(TEXT("%02d:%02d"), Total / 60, Total % 60);
	}

	FString ResultText(const FTCGameState& S, const FString& Me)
	{
		static const TMap<FString, FString> Why = {
			{TEXT("checkmate"), TEXT("CHECKMATE")}, {TEXT("stalemate"), TEXT("STALEMATE")}, {TEXT("insufficient_material"), TEXT("DRAW - NO MATING MATERIAL")},
			{TEXT("threefold_repetition"), TEXT("DRAW - REPETITION")}, {TEXT("fivefold_repetition"), TEXT("DRAW - FIVEFOLD REPETITION")},
			{TEXT("fifty_move"), TEXT("DRAW - FIFTY MOVES")}, {TEXT("seventy_five_move"), TEXT("DRAW - SEVENTY-FIVE MOVES")},
			{TEXT("agreement"), TEXT("DRAW AGREED")}, {TEXT("resignation"), TEXT("RESIGNATION")}, {TEXT("timeout"), TEXT("TIME")},
			{TEXT("timeout_vs_insufficient"), TEXT("TIME - DRAW, NO MATING MATERIAL")}, {TEXT("abandoned"), TEXT("ABANDONED")},
			{TEXT("abandoned_vs_insufficient"), TEXT("ABANDONED - DRAW")}, {TEXT("aborted"), TEXT("ABORTED")}};
		const FString Head = Why.Contains(S.Termination) ? Why[S.Termination] : S.Status.ToUpper();
		const FString Tail = S.Winner.IsEmpty() ? TEXT("") : (S.Winner == Me ? TEXT("  -  YOU WIN") : TEXT("  -  YOU LOSE"));
		return Head + Tail;
	}
}

// ─────────────────────────────── game mode ───────────────────────────────

ATCGameMode::ATCGameMode()
{
	PlayerControllerClass = ATCPlayerController::StaticClass();
	HUDClass = ATCHUD::StaticClass();
	DefaultPawnClass = nullptr;
}

FString ATCGameMode::GetServerLabel() const
{
	return IsOnline() ? ServerUrl : TEXT("local core");
}

void ATCGameMode::BeginPlay()
{
	Super::BeginPlay();
	FParse::Value(FCommandLine::Get(), TEXT("-tcserver="), ServerUrl);
	FParse::Value(FCommandLine::Get(), TEXT("-tcauto="), Auto);
	FParse::Value(FCommandLine::Get(), TEXT("-tcname="), Username);
	UGameInstance* GI = GetGameInstance();
	UTCCoreClient* Core = GI->GetSubsystem<UTCCoreClient>();
	Core->OnConnectionChanged.AddDynamic(this, &ATCGameMode::OnConnection);
	Core->OnState.AddDynamic(this, &ATCGameMode::OnState);
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (It->Tags.Contains(TEXT("TC_SeatMirror"))) SeatOriginals.Add(*It, It->GetActorTransform());
	}
	if (IsOnline())
	{
		Core->Connect(ServerUrl, TEXT(""), Username);
	}
	else
	{
		UTCLocalCore* Local = GI->GetSubsystem<UTCLocalCore>();
		Local->OnReady.AddDynamic(this, &ATCGameMode::OnCoreReady);
		if (Local->IsReady()) OnCoreReady(Local->GetUrl()); else Local->Start();
	}
}

void ATCGameMode::OnCoreReady(const FString& Url)
{
	UGameInstance* GI = GetGameInstance();
	UTCCoreClient* Core = GI->GetSubsystem<UTCCoreClient>();
	// after a core restart the client is already reconnecting to the same URL? the port changes, so reconnect
	Core->Connect(Url, GI->GetSubsystem<UTCLocalCore>()->GetSecret(), Username);
}

void ATCGameMode::OnConnection(const FString& State)
{
	UTCCoreClient* Core = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	if (Core->GetConnection() != ETCConnection::Welcomed || bAutoDone || Auto.IsEmpty() || Core->HasGame()) return;
	TArray<FString> Parts;
	Auto.ParseIntoArray(Parts, TEXT(":"));
	if (Parts.Num() >= 1 && Parts[0] == TEXT("cpu"))
	{
		bAutoDone = true;
		Core->CreateAiGame(Parts.IsValidIndex(1) ? Parts[1] : TEXT("patient"), Parts.IsValidIndex(2) ? Parts[2] : TEXT("w"), Parts.IsValidIndex(3) ? Parts[3] : TEXT("5+0"));
	}
	else if (Parts.Num() >= 1 && Parts[0] == TEXT("private"))
	{
		bAutoDone = true;
		Core->CreatePrivate(Parts.IsValidIndex(1) ? Parts[1] : TEXT("5+0"));
	}
	else if (Parts.Num() >= 2 && Parts[0] == TEXT("join"))
	{
		bAutoDone = true;
		Core->JoinGame(Parts[1]);
	}
}

void ATCGameMode::OnState(const FTCGameState& State, const FString& Reason)
{
	const FString Color = GetGameInstance()->GetSubsystem<UTCCoreClient>()->GetMyColor();
	if (!Color.IsEmpty() && Color != SeatApplied) ApplySeat(Color);
}

void ATCGameMode::ApplySeat(const FString& Color)
{
	SeatApplied = Color;
	ATCBoard* Board = Cast<ATCBoard>(UGameplayStatics::GetActorOfClass(GetWorld(), ATCBoard::StaticClass()));
	const float Cx = Board ? Board->GetActorLocation().X : 0.f;
	for (const auto& KV : SeatOriginals)
	{
		if (!KV.Key.IsValid()) continue;
		FTransform T = KV.Value;
		if (Color == TEXT("b"))
		{
			// the table is symmetric across the board centre: put the opponent, hands, chair and lamp on the other side
			FVector L = T.GetLocation();
			L.X = 2.f * Cx - L.X;
			L.Y = -L.Y;
			T.SetLocation(L);
			T.SetRotation((FRotator(0, 180, 0).Quaternion() * T.GetRotation()));
		}
		KV.Key->SetActorTransform(T);
	}
	UE_LOG(LogTownChess, Log, TEXT("seat: %s"), Color == TEXT("w") ? TEXT("White") : TEXT("Black"));
}

// ─────────────────────────────── controller ───────────────────────────────

ATCPlayerController::ATCPlayerController()
{
	bShowMouseCursor = true;
	bEnableClickEvents = true;
	DefaultMouseCursor = EMouseCursor::Default;
}

void ATCPlayerController::BeginPlay()
{
	Super::BeginPlay();
	SetInputMode(FInputModeGameAndUI().SetHideCursorDuringCapture(false));
	if (UTCCoreClient* C = Core()) C->OnState.AddDynamic(this, &ATCPlayerController::OnState);
	OnState(FTCGameState(), TEXT("init"));
}

void ATCPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	InputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &ATCPlayerController::OnClick);
	InputComponent->BindKey(EKeys::AnyKey, IE_Pressed, this, &ATCPlayerController::OnKey);
}

ATCBoard* ATCPlayerController::Board() const
{
	return Cast<ATCBoard>(UGameplayStatics::GetActorOfClass(GetWorld(), ATCBoard::StaticClass()));
}

UTCCoreClient* ATCPlayerController::Core() const
{
	return GetGameInstance() ? GetGameInstance()->GetSubsystem<UTCCoreClient>() : nullptr;
}

void ATCPlayerController::OnState(const FTCGameState& State, const FString& Reason)
{
	const UTCCoreClient* C = Core();
	const FString Seat = C && !C->GetMyColor().IsEmpty() ? C->GetMyColor() : TEXT("w");
	if (Seat == CameraFor) return;
	CameraFor = Seat;
	const FName Tag = Seat == TEXT("b") ? TEXT("TC_Camera_Black") : TEXT("TC_Camera_White");
	TArray<AActor*> Cams;
	UGameplayStatics::GetAllActorsWithTag(GetWorld(), Tag, Cams);
	if (Cams.Num()) SetViewTargetWithBlend(Cams[0], Reason == TEXT("init") ? 0.f : 1.2f, VTBlend_EaseInOut, 2.f);
}

void ATCPlayerController::OnClick()
{
	float X, Y;
	if (!GetMousePosition(X, Y)) return;
	if (ATCHUD* H = Cast<ATCHUD>(GetHUD()); H && H->HandleClick(FVector2D(X, Y))) return;
	ATCBoard* B = Board();
	if (!B) return;
	FVector Origin, Dir;
	if (!DeprojectScreenPositionToWorld(X, Y, Origin, Dir) || FMath::IsNearlyZero(Dir.Z)) return;
	const float T = (B->SurfaceZ() - Origin.Z) / Dir.Z;
	if (T <= 0) return;
	const FString Sq = B->SquareAtWorld(Origin + Dir * T);
	if (!Sq.IsEmpty()) B->ClickSquare(Sq);
}

void ATCPlayerController::OnKey(FKey Key)
{
	ATCBoard* B = Board();
	if (B && B->HasPendingPromotion())
	{
		const FString K = Key.GetFName().ToString().ToLower();
		if (K == TEXT("q") || K == TEXT("r") || K == TEXT("b") || K == TEXT("n")) B->ChoosePromotion(K);
		else if (Key == EKeys::Escape) B->ChoosePromotion(TEXT(""));
		return;
	}
	if (bTypingCode)
	{
		if (Key == EKeys::BackSpace) JoinCode.LeftChopInline(1);
		else if (Key == EKeys::Enter) { bTypingCode = false; if (UTCCoreClient* C = Core()) C->JoinGame(JoinCode.ToUpper()); }
		else if (Key == EKeys::Escape) bTypingCode = false;
		else
		{
			const FString K = Key.GetFName().ToString();
			if (K.Len() == 1 && JoinCode.Len() < 11) JoinCode += K.ToUpper();
			else if (K == TEXT("Hyphen") || K == TEXT("Subtract")) JoinCode += TEXT("-");
			static const TMap<FString, FString> Digits = {{TEXT("Zero"), TEXT("0")}, {TEXT("One"), TEXT("1")}, {TEXT("Two"), TEXT("2")}, {TEXT("Three"), TEXT("3")}, {TEXT("Four"), TEXT("4")}, {TEXT("Five"), TEXT("5")}, {TEXT("Six"), TEXT("6")}, {TEXT("Seven"), TEXT("7")}, {TEXT("Eight"), TEXT("8")}, {TEXT("Nine"), TEXT("9")}};
			if (const FString* D = Digits.Find(K)) JoinCode += *D;
		}
		return;
	}
	if (Key == EKeys::Escape && B) B->ClearSelection();
}

// ─────────────────────────────── HUD ───────────────────────────────

void ATCHUD::Text(const FString& S, float X, float Y, const FLinearColor& C, float Scale, bool bCenter)
{
	UFont* Font = GEngine->GetMediumFont();
	float W = 0, H = 0;
	Canvas->TextSize(Font, S, W, H, Scale, Scale);
	DrawText(S, C, bCenter ? X - W * 0.5f : X, Y, Font, Scale);
}

void ATCHUD::Button(const FString& Id, const FString& Label, float X, float Y, float W)
{
	const FVector2D Size(W, 34.f);
	DrawRect(FLinearColor(0.02f, 0.02f, 0.018f, 0.78f), X, Y, Size.X, Size.Y);
	DrawRect(FLinearColor(0.55f, 0.45f, 0.28f, 0.9f), X, Y + Size.Y - 2.f, Size.X, 2.f);
	Text(Label, X + 12.f, Y + 7.f, FLinearColor(0.86f, 0.80f, 0.68f), 1.f);
	Buttons.Add({Id, Label, FVector2D(X, Y), Size});
}

TArray<FString> ATCHUD::GetVisibleButtons() const
{
	TArray<FString> Out;
	for (const FButton& B : Buttons) Out.Add(B.Id);
	return Out;
}

bool ATCHUD::HandleClick(const FVector2D& Pos)
{
	for (const FButton& B : Buttons)
	{
		if (Pos.X >= B.Pos.X && Pos.X <= B.Pos.X + B.Size.X && Pos.Y >= B.Pos.Y && Pos.Y <= B.Pos.Y + B.Size.Y) { PressButton(B.Id); return true; }
	}
	return false;
}

void ATCHUD::OnRejected(const FString& Reason) { Toast = FString::Printf(TEXT("The move was refused: %s"), *Reason); ToastUntil = FPlatformTime::Seconds() + 3.5; }
void ATCHUD::OnError(const FString& Message) { Toast = Message; ToastUntil = FPlatformTime::Seconds() + 3.5; }

void ATCHUD::PressButton(const FString& Id)
{
	UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	ATCPlayerController* PC = Cast<ATCPlayerController>(GetOwningPlayerController());
	ATCBoard* B = PC ? PC->Board() : nullptr;
	if (Id == TEXT("level")) Level = Level == TEXT("novice") ? TEXT("patient") : Level == TEXT("patient") ? TEXT("warden") : TEXT("novice");
	else if (Id == TEXT("tc")) TimeControl = TimeControl == TEXT("5+0") ? TEXT("10+0") : TimeControl == TEXT("10+0") ? TEXT("untimed") : TimeControl == TEXT("untimed") ? TEXT("3+2") : TEXT("5+0");
	else if (Id == TEXT("cpu_w")) C->CreateAiGame(Level, TEXT("w"), TimeControl);
	else if (Id == TEXT("cpu_b")) C->CreateAiGame(Level, TEXT("b"), TimeControl);
	else if (Id == TEXT("private")) C->CreatePrivate(TimeControl == TEXT("untimed") ? TEXT("10+0") : TimeControl);
	else if (Id == TEXT("casual")) C->FindMatch(TimeControl == TEXT("untimed") ? TEXT("5+0") : TimeControl, false);
	else if (Id == TEXT("join") && PC) { PC->bTypingCode = true; PC->JoinCode = TEXT("GAME-"); }
	else if (Id == TEXT("offer")) C->OfferDraw();
	else if (Id == TEXT("accept")) C->AcceptDraw();
	else if (Id == TEXT("decline")) C->DeclineDraw();
	else if (Id == TEXT("claim")) C->ClaimDraw();
	else if (Id == TEXT("resign")) { if (bConfirmResign) { C->Resign(); bConfirmResign = false; } else bConfirmResign = true; }
	else if (Id == TEXT("rematch")) C->Rematch();
	else if (Id == TEXT("leave")) C->LeaveGame();
	else if (Id.StartsWith(TEXT("promo_")) && B) B->ChoosePromotion(Id.RightChop(6));
	if (Id != TEXT("resign")) bConfirmResign = false;
}

void ATCHUD::DrawHUD()
{
	Super::DrawHUD();
	Buttons.Reset();
	UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	if (!C) return;
	if (!bBound) { C->OnMoveRejected.AddDynamic(this, &ATCHUD::OnRejected); C->OnError.AddDynamic(this, &ATCHUD::OnError); bBound = true; }
	if (C->HasGame() && C->GetState().Status != TEXT("waiting")) DrawGame(C); else DrawMenu(C);
	if (FPlatformTime::Seconds() < ToastUntil) Text(Toast, Canvas->ClipX * 0.5f, Canvas->ClipY - 70.f, FLinearColor(0.95f, 0.35f, 0.25f), 1.1f, true);
	if (C->GetConnection() != ETCConnection::Welcomed)
	{
		const ATCGameMode* GM = Cast<ATCGameMode>(UGameplayStatics::GetGameMode(this));
		Text(FString::Printf(TEXT("connecting to %s..."), GM ? *GM->GetServerLabel() : TEXT("core")), Canvas->ClipX * 0.5f, Canvas->ClipY - 40.f, FLinearColor(0.7f, 0.7f, 0.65f), 0.9f, true);
	}
}

void ATCHUD::DrawMenu(UTCCoreClient* C)
{
	const float X = 60.f, Y0 = 90.f;
	Text(TEXT("TOWNCHESS"), X, Y0 - 50.f, FLinearColor(0.86f, 0.78f, 0.6f), 2.2f);
	if (C->HasGame() && C->GetState().Status == TEXT("waiting"))
	{
		Text(FString::Printf(TEXT("Your table: %s   -   waiting for an opponent"), *C->GetState().Id), X, Y0 + 10.f, FLinearColor(0.9f, 0.85f, 0.7f), 1.2f);
		Button(TEXT("leave"), TEXT("Leave table"), X, Y0 + 50.f);
		return;
	}
	Button(TEXT("cpu_w"), TEXT("Play The Annotator - White"), X, Y0 + 10.f, 320.f);
	Button(TEXT("cpu_b"), TEXT("Play The Annotator - Black"), X, Y0 + 52.f, 320.f);
	Button(TEXT("level"), FString::Printf(TEXT("Strength: %s"), *Level), X, Y0 + 94.f, 320.f);
	Button(TEXT("tc"), FString::Printf(TEXT("Clock: %s"), *TimeControl), X, Y0 + 136.f, 320.f);
	Button(TEXT("private"), TEXT("Create private table"), X, Y0 + 196.f, 320.f);
	Button(TEXT("casual"), TEXT("Find casual opponent"), X, Y0 + 238.f, 320.f);
	const ATCPlayerController* PC = Cast<ATCPlayerController>(GetOwningPlayerController());
	Button(TEXT("join"), PC && PC->bTypingCode ? FString::Printf(TEXT("Join: %s_  (Enter)"), *PC->JoinCode) : TEXT("Join table by code"), X, Y0 + 280.f, 320.f);
}

void ATCHUD::DrawGame(UTCCoreClient* C)
{
	const FTCGameState& S = C->GetState();
	const FString Me = C->GetMyColor();
	const FString Them = Me == TEXT("w") ? TEXT("b") : TEXT("w");
	const FTCPlayer& MeP = Me == TEXT("w") ? S.White : S.Black;
	const FTCPlayer& ThemP = Me == TEXT("w") ? S.Black : S.White;
	const FLinearColor Ink(0.88f, 0.82f, 0.70f), Dim(0.62f, 0.58f, 0.5f);
	const auto Plate = [&](const FTCPlayer& P, const FString& Col, float X, bool bRight)
	{
		const FString Name = P.AiLevel.IsEmpty() ? P.Username : FString::Printf(TEXT("THE ANNOTATOR (%s)"), *P.AiLevel);
		const FString Sub = P.Rating >= 0 ? FString::Printf(TEXT("%s  %d"), Col == TEXT("w") ? TEXT("White") : TEXT("Black"), P.Rating) : (Col == TEXT("w") ? TEXT("White") : TEXT("Black"));
		const float W = 300.f;
		const float Bx = bRight ? X - W : X;
		DrawRect(FLinearColor(0.02f, 0.02f, 0.02f, 0.7f), Bx, 20.f, W, 78.f);
		Text(Name, Bx + 12.f, 26.f, Ink, 1.f);
		Text(Sub, Bx + 12.f, 48.f, Dim, 0.85f);
		const bool bRun = S.IsActive() && S.Turn == Col;
		Text(S.IsTimed() ? ClockText(C->GetDisplayClockMs(Col)) : TEXT("--:--"), Bx + W - 110.f, 34.f, bRun ? FLinearColor(1.f, 0.85f, 0.5f) : Dim, 1.6f);
	};
	Plate(MeP, Me, 20.f, false);
	Plate(ThemP, Them, Canvas->ClipX - 20.f, true);

	FString Status;
	ATCPlayerController* PC = Cast<ATCPlayerController>(GetOwningPlayerController());
	ATCBoard* B = PC ? PC->Board() : nullptr;
	if (S.IsFinished()) Status = ResultText(S, Me);
	else if (B && B->IsAwaitingCore()) Status = TEXT("...");
	else if (C->IsMyTurn()) Status = TEXT("Your move");
	else Status = ThemP.AiLevel.IsEmpty() ? TEXT("Opponent to move") : TEXT("The Annotator is writing...");
	for (const FTCGameEvent& E : S.LastEvents) if (E.Type == TEXT("check") && S.IsActive()) Status = TEXT("CHECK  -  ") + Status;
	Text(Status, Canvas->ClipX * 0.5f, 30.f, S.IsFinished() ? FLinearColor(0.95f, 0.8f, 0.55f) : Ink, S.IsFinished() ? 1.6f : 1.2f, true);
	if (!S.OpeningName.IsEmpty()) Text(FString::Printf(TEXT("%s  %s"), *S.OpeningEco, *S.OpeningName), Canvas->ClipX * 0.5f, 64.f, Dim, 0.85f, true);
	if (S.Disconnected.Contains(Them)) Text(TEXT("Opponent disconnected - waiting"), Canvas->ClipX * 0.5f, 88.f, FLinearColor(0.9f, 0.6f, 0.3f), 0.9f, true);

	float Y = 140.f;
	if (S.IsActive())
	{
		if (!S.DrawOfferBy.IsEmpty() && S.DrawOfferBy != Me)
		{
			Text(TEXT("Your opponent offers a draw"), 20.f, Y, Ink, 0.95f); Y += 26.f;
			Button(TEXT("accept"), TEXT("Accept draw"), 20.f, Y, 200.f); Y += 40.f;
			Button(TEXT("decline"), TEXT("Decline"), 20.f, Y, 200.f); Y += 52.f;
		}
		else Button(TEXT("offer"), S.DrawOfferBy == Me ? TEXT("Draw offered") : TEXT("Offer draw"), 20.f, Y, 200.f), Y += 40.f;
		if (!S.ClaimableDraw.IsEmpty() && C->IsMyTurn()) { Button(TEXT("claim"), FString::Printf(TEXT("Claim draw (%s)"), *S.ClaimableDraw), 20.f, Y, 200.f); Y += 40.f; }
		Button(TEXT("resign"), bConfirmResign ? TEXT("Click again to resign") : TEXT("Resign"), 20.f, Y, 200.f);
	}
	else if (S.IsFinished())
	{
		Button(TEXT("rematch"), S.RematchOfferBy.IsEmpty() ? TEXT("Rematch") : (S.RematchOfferBy == Me ? TEXT("Rematch offered") : TEXT("Accept rematch")), 20.f, Y, 200.f);
		Button(TEXT("leave"), TEXT("Leave table"), 20.f, Y + 40.f, 200.f);
	}
	if (B && B->HasPendingPromotion())
	{
		const float Cx = Canvas->ClipX * 0.5f - 2.f * 110.f;
		Text(TEXT("Promote to"), Canvas->ClipX * 0.5f, Canvas->ClipY * 0.5f - 60.f, Ink, 1.2f, true);
		Button(TEXT("promo_q"), TEXT("Queen (Q)"), Cx, Canvas->ClipY * 0.5f - 20.f, 100.f);
		Button(TEXT("promo_r"), TEXT("Rook (R)"), Cx + 110.f, Canvas->ClipY * 0.5f - 20.f, 100.f);
		Button(TEXT("promo_b"), TEXT("Bishop (B)"), Cx + 220.f, Canvas->ClipY * 0.5f - 20.f, 100.f);
		Button(TEXT("promo_n"), TEXT("Knight (N)"), Cx + 330.f, Canvas->ClipY * 0.5f - 20.f, 100.f);
	}
}
