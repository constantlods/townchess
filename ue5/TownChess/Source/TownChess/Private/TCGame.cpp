#include "TCGame.h"

#include "Camera/CameraActor.h"
#include "Engine/Canvas.h"
#include "CanvasItem.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Engine/FontFace.h"
#include "Animation/SkeletalMeshActor.h"
#include "Components/SkeletalMeshComponent.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Engine/TextureRenderTarget2D.h"
#include "DynamicRHI.h"
#include "RHIGlobals.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/Parse.h"
#include "TCBoard.h"
#include "TCClipboard.h"
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
	PrimaryActorTick.bCanEverTick = true;
	PlayerControllerClass = ATCPlayerController::StaticClass();
	HUDClass = ATCHUD::StaticClass();
	DefaultPawnClass = nullptr;
}

FString ATCGameMode::GetServerLabel() const
{
	return IsOnline() ? ServerUrl : TEXT("local core");
}

/** The character group an actor belongs to: TC_Opponent_<id> (roster) or TC_PlayerBody (first-person arms). */
/** Quality on start: hardware-ray-traced Lumen and RT shadows plus Epic scalability on GPUs that support ray tracing
 *  (the owner's RTX); software Lumen at High elsewhere (the RX 6650 XT target). -tcquality=low|medium|high|epic|cinematic
 *  overrides; DLSS is switched on when its plugin is present (its cvars are simply ignored otherwise). */
void ATCGameMode::ApplyQualityPreset()
{
	FString Q;
	const bool bRT = GRHISupportsRayTracing && GRHISupportsRayTracingShaders;
	if (!FParse::Value(FCommandLine::Get(), TEXT("-tcquality="), Q)) Q = bRT ? TEXT("epic") : TEXT("high");
	const int32 Level = Q == TEXT("low") ? 0 : Q == TEXT("medium") ? 1 : Q == TEXT("high") ? 2 : Q == TEXT("cinematic") ? 4 : 3;
	auto Exec = [this](const FString& C) { GEngine->Exec(GetWorld(), *C); };
	for (const TCHAR* G : { TEXT("ViewDistanceQuality"), TEXT("AntiAliasingQuality"), TEXT("ShadowQuality"), TEXT("GlobalIlluminationQuality"),
		TEXT("ReflectionQuality"), TEXT("PostProcessQuality"), TEXT("TextureQuality"), TEXT("EffectsQuality"), TEXT("ShadingQuality") })
	{
		Exec(FString::Printf(TEXT("sg.%s %d"), G, Level));
	}
	const bool bHW = bRT && Level >= 3;
	Exec(FString::Printf(TEXT("r.Lumen.HardwareRayTracing %d"), bHW ? 1 : 0));
	Exec(FString::Printf(TEXT("r.Lumen.Reflections.HardwareRayTracing %d"), bHW ? 1 : 0));
	Exec(FString::Printf(TEXT("r.RayTracing.Shadows %d"), bHW ? 1 : 0));
	Exec(TEXT("r.NGX.DLSS.Enable 1"));
	UE_LOG(LogTownChess, Log, TEXT("quality: %s (level %d), hardware ray tracing %s"), *Q, Level, bHW ? TEXT("on") : TEXT("off"));
}

static FName OpponentTagOf(const AActor* A)
{
	for (const FName& T : A->Tags)
	{
		if (T.ToString().StartsWith(TEXT("TC_Opponent_")) || T == TEXT("TC_PlayerBody")) return T;
	}
	return NAME_None;
}

void ATCGameMode::ApplyOpponent(const FString& Id)
{
	const FName Want(*(TEXT("TC_Opponent_") + Id));
	bool bFound = false;
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		const FName T = OpponentTagOf(*It);
		if (T != NAME_None && T == Want) bFound = true;
	}
	const FName Show = bFound ? Want : FName(TEXT("TC_Opponent_caged"));
	TMap<FName, USkeletalMeshComponent*> Bodies;
	for (TActorIterator<ASkeletalMeshActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(TEXT("TC_Body"))) Bodies.Add(OpponentTagOf(*It), It->GetSkeletalMeshComponent());
	}
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		const FName T = OpponentTagOf(*It);
		if (T == NAME_None) continue;
		if (T != TEXT("TC_PlayerBody"))
		{
			It->SetActorHiddenInGame(T != Show);
			It->SetActorEnableCollision(T == Show);
		}
		if (It->ActorHasTag(TEXT("TC_FollowBody")))
		{
			if (USkeletalMeshComponent* const* B = Bodies.Find(T))
			{
				Cast<ASkeletalMeshActor>(*It)->GetSkeletalMeshComponent()->SetLeaderPoseComponent(*B);
			}
		}
	}
	OpponentShown = Show.ToString().RightChop(12);
	UE_LOG(LogTownChess, Log, TEXT("opponent: %s%s"), *OpponentShown, bFound ? TEXT("") : TEXT(" (requested one not in the level)"));
}

void ATCGameMode::BeginPlay()
{
	Super::BeginPlay();
	// Opponent roster: every character is built into the level, tagged TC_Opponent_<id>. Show the selected one
	// (-tcopponent=<id>, default "caged") and hide the rest. MetaHuman faces/outfits are separate skeletal mesh actors
	// that follow their own body's skeleton (leader pose), which is runtime state and so is linked here.
	ApplyQualityPreset();
	// First-person arms: the player's own MetaHuman body sits at the camera; its head (and neck) must not be drawn.
	for (TActorIterator<ASkeletalMeshActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(TEXT("TC_PlayerBody")) && It->ActorHasTag(TEXT("TC_Body")))
		{
			It->GetSkeletalMeshComponent()->HideBoneByName(TEXT("neck_01"), EPhysBodyOp::PBO_None);
			It->GetSkeletalMeshComponent()->SetCastShadow(true);
		}
	}
	FString OpponentId = TEXT("caged");
	FParse::Value(FCommandLine::Get(), TEXT("-tcopponent="), OpponentId);
	ApplyOpponent(OpponentId);
	FParse::Value(FCommandLine::Get(), TEXT("-tcserver="), ServerUrl);
	FParse::Value(FCommandLine::Get(), TEXT("-tcauto="), Auto);
	FParse::Value(FCommandLine::Get(), TEXT("-tcname="), Username);
	FParse::Value(FCommandLine::Get(), TEXT("-tcsmoke="), SmokePlies);
	if (SmokePlies > 0)
	{
		if (Auto.IsEmpty()) Auto = TEXT("cpu:novice:w:untimed");
		SmokeDeadline = FPlatformTime::Seconds() + 600.0;
		UE_LOG(LogTownChess, Log, TEXT("smoke test: %d plies"), SmokePlies);
	}
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

void ATCGameMode::Tick(float Dt)
{
	Super::Tick(Dt);
	if (SmokePlies > 0) SmokeTick();
}

void ATCGameMode::SmokeTick()
{
	UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	ATCBoard* B = Cast<ATCBoard>(UGameplayStatics::GetActorOfClass(GetWorld(), ATCBoard::StaticClass()));
	if (!C || !B) return;
	if (FPlatformTime::Seconds() > SmokeDeadline) { SmokeFinish(TEXT("timeout")); return; }
	const FTCGameState& S = C->GetState();
	if (!C->HasGame() || B->IsAnimating() || B->IsAwaitingCore()) return;
	// Only a game this run started counts: the local core may restore an unfinished game from its journal (an earlier
	// run), which would otherwise "pass" with its old plies. Resign and leave it, then play our own.
	if (SmokeGameId.IsEmpty())
	{
		if (bAutoDone && S.IsActive() && S.History.Num() == 0) { SmokeGameId = S.Id; SmokeLog.Add(FString::Printf(TEXT("own game %s vs %s"), *S.Id, *(S.White.AiLevel + S.Black.AiLevel))); }
		else if (S.IsActive()) { if (!bSmokeResigned) { SmokeLog.Add(TEXT("resigning a restored game ") + S.Id); C->Resign(); bSmokeResigned = true; } return; }
		else { C->LeaveGame(); bAutoDone = false; TryAutoStart(); return; }  // the auto-start was refused ("busy") by the restored game: start ours now (no new connection event would)
	}
	if (S.Id != SmokeGameId) return;
	const int32 Ply = S.History.Num();
	if (Ply != SmokeChecked)
	{
		// every authoritative position must be shown exactly, without a silent repair
		const bool bOk = B->IsInSync() && B->GetResyncs() == 0 && B->GetPhysicalMismatches() == 0;
		if (!bOk) ++SmokeFailures;
		SmokeLog.Add(FString::Printf(TEXT("ply %d %s %s"), Ply, Ply > 0 ? *S.History.Last().San : TEXT("start"), bOk ? TEXT("ok") : TEXT("MISMATCH")));
		SmokeChecked = Ply;
	}
	if (S.IsFinished() || Ply >= SmokePlies) { SmokeFinish(S.IsFinished() ? S.Status : TEXT("plies reached")); return; }
	if (!C->IsMyTurn() || S.LegalMoves.Num() == 0) return;
	const FString Mv = S.LegalMoves[0];
	B->ClickSquare(Mv.Left(2));
	if (B->ClickSquare(Mv.Mid(2, 2)) == ETCClickResult::NeedsPromotion) B->ChoosePromotion(Mv.Len() == 5 ? Mv.Mid(4, 1) : TEXT("q"));
}

void ATCGameMode::SmokeFinish(const FString& Why)
{
	UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	UTCLocalCore* L = GetGameInstance()->GetSubsystem<UTCLocalCore>();
	const bool bPass = SmokeFailures == 0 && !SmokeGameId.IsEmpty() && SmokeChecked >= FMath::Min(SmokePlies, 2) && Why != TEXT("timeout");
	FString Json = FString::Printf(TEXT("{\n  \"pass\": %s,\n  \"reason\": \"%s\",\n  \"plies\": %d,\n  \"failures\": %d,\n  \"rhi\": \"%s\",\n  \"corePid\": %d,\n  \"coreUrl\": \"%s\",\n  \"log\": [\n"),
		bPass ? TEXT("true") : TEXT("false"), *Why, SmokeChecked, SmokeFailures, GDynamicRHI ? GDynamicRHI->GetName() : TEXT("?"), L ? L->GetCorePid() : 0, L ? *L->GetUrl() : TEXT(""));
	for (int32 i = 0; i < SmokeLog.Num(); ++i) Json += FString::Printf(TEXT("    \"%s\"%s\n"), *SmokeLog[i], i + 1 < SmokeLog.Num() ? TEXT(",") : TEXT(""));
	Json += TEXT("  ]\n}\n");
	FFileHelper::SaveStringToFile(Json, *(FPaths::ProjectSavedDir() / TEXT("TownChess") / TEXT("smoke.json")));
	UE_LOG(LogTownChess, Log, TEXT("smoke test %s (%s, %d plies, %d failures)"), bPass ? TEXT("PASS") : TEXT("FAIL"), *Why, SmokeChecked, SmokeFailures);
	SmokePlies = 0;
	FGenericPlatformMisc::RequestExit(false);
}

void ATCGameMode::EndPlay(const EEndPlayReason::Type Reason)
{
	// subsystems outlive the level: never leave delegates pointing at a dead game mode
	if (UGameInstance* GI = GetGameInstance())
	{
		if (UTCCoreClient* C = GI->GetSubsystem<UTCCoreClient>()) { C->OnConnectionChanged.RemoveAll(this); C->OnState.RemoveAll(this); }
		if (UTCLocalCore* L = GI->GetSubsystem<UTCLocalCore>()) L->OnReady.RemoveAll(this);
	}
	Super::EndPlay(Reason);
}

void ATCGameMode::OnCoreReady(const FString& Url)
{
	UGameInstance* GI = GetGameInstance();
	UTCCoreClient* Core = GI->GetSubsystem<UTCCoreClient>();
	// after a core restart the client is already reconnecting to the same URL? the port changes, so reconnect
	Core->Connect(Url, GI->GetSubsystem<UTCLocalCore>()->GetSecret(), Username);
}

void ATCGameMode::OnConnection(const FString& State) { TryAutoStart(); }

void ATCGameMode::TryAutoStart()
{
	UTCCoreClient* Core = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	if (Core->GetConnection() != ETCConnection::Welcomed || bAutoDone || Auto.IsEmpty() || (Core->HasGame() && !Core->GetState().IsFinished())) return;
	TArray<FString> Parts;
	Auto.ParseIntoArray(Parts, TEXT(":"));
	if (Parts.Num() >= 1 && Parts[0] == TEXT("cpu"))
	{
		bAutoDone = true;
		FString StartFen;  // -tcstartfen=<FEN with _ for spaces> (autotests; needs -tcallowstartfen for the local core)
		if (FParse::Value(FCommandLine::Get(), TEXT("-tcstartfen="), StartFen)) StartFen.ReplaceInline(TEXT("_"), TEXT(" "));
		Core->CreateAiGame(Parts.IsValidIndex(1) ? Parts[1] : TEXT("patient"), Parts.IsValidIndex(2) ? Parts[2] : TEXT("w"), Parts.IsValidIndex(3) ? Parts[3] : TEXT("5+0"), StartFen);
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
	if (!FParse::Param(FCommandLine::Get(), TEXT("tcmirrorroom")))
	{
		// The player always sits in the dressed seat (lamp, cart, the room behind the opponent); as Black the board
		// turns round so Black's pieces are nearest. The board maps squares through its own transform (drawing, clicks).
		if (Board) Board->SetActorRotation(FRotator(0.f, Color == TEXT("b") ? 180.f : 0.f, 0.f));
		UE_LOG(LogTownChess, Log, TEXT("seat: %s (board turned %d)"), Color == TEXT("w") ? TEXT("White") : TEXT("Black"), Color == TEXT("b") ? 180 : 0);
		return;
	}
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

void ATCPlayerController::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UTCCoreClient* C = Core()) C->OnState.RemoveAll(this);
	Super::EndPlay(Reason);
}

void ATCPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	InputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &ATCPlayerController::OnClick);
	InputComponent->BindKey(EKeys::LeftMouseButton, IE_Released, this, &ATCPlayerController::OnRelease);
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
	// one dressed seat: the board turns for Black (ATCGameMode::ApplySeat); -tcmirrorroom restores the moving camera
	const FName Tag = Seat == TEXT("b") && FParse::Param(FCommandLine::Get(), TEXT("tcmirrorroom")) ? TEXT("TC_Camera_Black") : TEXT("TC_Camera_White");
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
	if (Sq.IsEmpty()) return;
	// press on an own piece starts a drag (release on another square = move; release in place = select);
	// pressing elsewhere is the second click of click-to-move
	if (!B->BeginDrag(Sq)) B->ClickSquare(Sq);
}

bool ATCPlayerController::PointerOnBoard(FString& Square, FVector& World) const
{
	float X, Y;
	ATCBoard* B = Board();
	FVector Origin, Dir;
	if (!B || !GetMousePosition(X, Y) || !DeprojectScreenPositionToWorld(X, Y, Origin, Dir) || FMath::IsNearlyZero(Dir.Z)) return false;
	const float T = (B->SurfaceZ() - Origin.Z) / Dir.Z;
	if (T <= 0) return false;
	World = Origin + Dir * T;
	Square = B->SquareAtWorld(World);
	return true;
}

void ATCPlayerController::OnRelease()
{
	ATCBoard* B = Board();
	if (!B || !B->IsDragging()) return;
	FString Sq;
	FVector W;
	PointerOnBoard(Sq, W);
	if (B->EndDrag(Sq) == ETCClickResult::NeedsPromotion) { /* the HUD shows the promotion picker */ }
}

void ATCPlayerController::PlayerTick(float Dt)
{
	Super::PlayerTick(Dt);
	ATCBoard* B = Board();
	if (!B) return;
	FString Sq;
	FVector W;
	const bool bOn = PointerOnBoard(Sq, W);
	if (B->IsDragging() && bOn) B->UpdateDrag(W + FVector(0, 0, 0.f));
	B->SetHover(bOn ? Sq : FString());
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
	if (Key == EKeys::Tab && !bTypingCode)
	{
		if (ATCClipboard* Clip = Cast<ATCClipboard>(UGameplayStatics::GetActorOfClass(GetWorld(), ATCClipboard::StaticClass()))) Clip->Toggle();
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

// reference UI style: typewriter caps, dark translucent plates, thin warm borders, hover highlight

UFont* ATCHUD::UiFont(ETCUiFont Which)
{
	// The reference's UI: thin monospace capitals for section titles (Courier Prime), a clean sans for everything read
	// in play (Lato Light/Regular). All OFL, imported by the level builder into /Game/TownChess/Fonts (always cooked).
	static const TCHAR* Faces[] = {TEXT("/Game/TownChess/Fonts/F_TC_Sans_Face.F_TC_Sans_Face"),
	                               TEXT("/Game/TownChess/Fonts/F_TC_SansLight_Face.F_TC_SansLight_Face"),
	                               TEXT("/Game/TownChess/Fonts/F_TC_Title_Face.F_TC_Title_Face")};
	const int32 I = static_cast<int32>(Which);
	if (Fonts.Num() < 3) Fonts.SetNum(3);
	if (!Fonts[I])
	{
		UFontFace* Face = LoadObject<UFontFace>(nullptr, Faces[I]);
		for (TActorIterator<ATCClipboard> It(GetWorld()); It && !Face; ++It) Face = It->FormFace;  // older levels
		if (Face)
		{
			UFont* F = NewObject<UFont>(this);
			F->FontCacheType = EFontCacheType::Runtime;
			F->LegacyFontSize = 22;
			FTypefaceEntry& E = F->GetMutableInternalCompositeFont().DefaultTypeface.Fonts.AddDefaulted_GetRef();
			E.Name = TEXT("Regular");
			E.Font = FFontData(Face);
			Fonts[I] = F;
		}
	}
	return Fonts[I] ? Fonts[I].Get() : GEngine->GetMediumFont();
}

float ATCHUD::Ui() const { return Canvas ? FMath::Clamp(Canvas->ClipY / 1080.f, 0.6f, 2.5f) : 1.f; }

float ATCHUD::TextWidth(const FString& S, float Scale, ETCUiFont Which)
{
	float W = 0, H = 0;
	Canvas->TextSize(UiFont(Which), S, W, H, Scale * Ui(), Scale * Ui());
	return W;
}

void ATCHUD::Text(const FString& S, float X, float Y, const FLinearColor& C, float Scale, bool bCenter, ETCUiFont Which)
{
	UFont* F = UiFont(Which);
	const float Sc = Scale * Ui();
	const float W = bCenter ? TextWidth(S, Scale, Which) : 0.f;
	FCanvasTextItem Item(FVector2D(X - W * 0.5f, Y), FText::FromString(S), F, C);
	Item.Scale = FVector2D(Sc, Sc);
	Item.EnableShadow(FLinearColor(0, 0, 0, 0.7f), FVector2D(1, 1));
	Canvas->DrawItem(Item);
}

void ATCHUD::Plate(float X, float Y, float W, float H, float Alpha, float BorderAlpha, const FLinearColor& Fill)
{
	DrawRect(FLinearColor(Fill.R, Fill.G, Fill.B, Alpha), X, Y, W, H);
	if (BorderAlpha <= 0.f) return;
	const FLinearColor B(0.62f, 0.55f, 0.42f, BorderAlpha);
	DrawRect(B, X, Y, W, 1.f); DrawRect(B, X, Y + H - 1.f, W, 1.f); DrawRect(B, X, Y, 1.f, H); DrawRect(B, X + W - 1.f, Y, 1.f, H);
}

bool ATCHUD::Hovered(float X, float Y, float W, float H) const
{
	float Mx = -1, My = -1;
	if (const APlayerController* PC = GetOwningPlayerController()) PC->GetMousePosition(Mx, My);
	return Mx >= X && Mx <= X + W && My >= Y && My <= Y + H;
}

void ATCHUD::Button(const FString& Id, const FString& Label, float X, float Y, float W, ETCButton Style)
{
	const float U = Ui();
	const FVector2D Size(W * U, 34.f * U);
	const bool bHover = Hovered(X, Y, Size.X, Size.Y);
	FLinearColor Ink(0.84f, 0.80f, 0.72f);
	switch (Style)
	{
	case ETCButton::Plain:    // the reference's quiet list (Offer Draw / Resign, menu rows): text only, a faint plate on hover
		if (bHover) Plate(X, Y, Size.X, Size.Y, 0.45f, 0.25f);
		break;
	case ETCButton::Boxed:    // selected row / option
		Plate(X, Y, Size.X, Size.Y, bHover ? 0.75f : 0.55f, bHover ? 0.8f : 0.45f, FLinearColor(0.09f, 0.08f, 0.065f));
		break;
	case ETCButton::Primary:  // "Find Match": filled bronze with a warm border
		Plate(X, Y, Size.X, Size.Y, bHover ? 0.95f : 0.85f, 0.9f, bHover ? FLinearColor(0.24f, 0.17f, 0.09f) : FLinearColor(0.17f, 0.12f, 0.065f));
		Ink = FLinearColor(0.95f, 0.88f, 0.74f);
		break;
	}
	if (bHover) Ink = FLinearColor(1.f, 0.94f, 0.82f);
	const float Ty = Y + 6.f * U;
	if (Style == ETCButton::Primary) Text(Label, X + Size.X * 0.5f, Ty, Ink, 0.95f, true);
	else Text(Label, X + 12.f * U, Ty, Ink, 0.9f);
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

FString ATCHUD::OpponentName(const FString& Id)
{
	return Id == TEXT("annotator") ? TEXT("The Annotator") : TEXT("The Patient");
}

void ATCHUD::PressButton(const FString& Id)
{
	UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	ATCPlayerController* PC = Cast<ATCPlayerController>(GetOwningPlayerController());
	ATCBoard* B = PC ? PC->Board() : nullptr;
	if (Id == TEXT("level"))
	{
		const TArray<FTCAiLevel>& L = C->GetAiLevels();
		const int32 I = L.IndexOfByPredicate([&](const FTCAiLevel& X) { return X.Id == Level; });
		if (L.Num()) Level = L[(I + 1) % L.Num()].Id;
	}
	else if (Id == TEXT("opponent"))
	{
		if (ATCGameMode* GM = GetWorld()->GetAuthGameMode<ATCGameMode>())
		{
			GM->ApplyOpponent(GM->GetOpponent() == TEXT("caged") ? TEXT("annotator") : TEXT("caged"));
		}
	}
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
	DrawUi();
}

void ATCHUD::DrawToRenderTarget(UTextureRenderTarget2D* Target)
{
	if (!Target) return;
	UCanvas* const ViewportCanvas = Canvas;
	UCanvas* RtCanvas = nullptr;
	FVector2D Size;
	FDrawToRenderTargetContext Ctx;
	UKismetRenderingLibrary::BeginDrawCanvasToRenderTarget(this, Target, RtCanvas, Size, Ctx);  // draws over, no clear
	Canvas = RtCanvas;
	if (Canvas) DrawUi();
	UKismetRenderingLibrary::EndDrawCanvasToRenderTarget(this, Ctx);
	Canvas = ViewportCanvas;
}

void ATCHUD::DrawUi()
{
	Buttons.Reset();
	UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>();
	if (!C) return;
	if (!bBound) { C->OnMoveRejected.AddDynamic(this, &ATCHUD::OnRejected); C->OnError.AddDynamic(this, &ATCHUD::OnError); bBound = true; }
	if (C->HasGame() && C->GetState().Status != TEXT("waiting")) DrawGame(C); else DrawMenu(C);
	if (FPlatformTime::Seconds() < ToastUntil) Text(Toast, Canvas->ClipX * 0.5f, Canvas->ClipY - 104.f * Ui(), FLinearColor(0.95f, 0.35f, 0.25f), 1.0f, true);
	if (C->GetConnection() != ETCConnection::Welcomed)
	{
		const ATCGameMode* GM = Cast<ATCGameMode>(UGameplayStatics::GetGameMode(this));
		Text(FString::Printf(TEXT("connecting to %s..."), GM ? *GM->GetServerLabel() : TEXT("core")), Canvas->ClipX * 0.5f, Canvas->ClipY - 40.f, FLinearColor(0.7f, 0.7f, 0.65f), 0.9f, true);
	}
}

void ATCHUD::DrawMenu(UTCCoreClient* C)
{
	// the reference's FIND A GAME panel: a monospace title, a quiet list of modes, one filled primary button, the clock row
	const float U = Ui(), X = 80.f * U, Y0 = 170.f * U, Step = 40.f * U, W = 300.f;
	const FLinearColor Dim(0.6f, 0.56f, 0.5f);
	Plate(X - 30.f * U, Y0 - 110.f * U, (W + 60.f) * U, 610.f * U, 0.62f, 0.0f);
	Text(TEXT("FIND A GAME"), X, Y0 - 80.f * U, FLinearColor(0.9f, 0.86f, 0.78f), 1.3f, false, ETCUiFont::Title);
	if (C->HasGame() && C->GetState().Status == TEXT("waiting"))
	{
		Text(TEXT("Your table"), X, Y0, Dim, 0.8f);
		Text(C->GetState().Id, X, Y0 + 24.f * U, FLinearColor(0.95f, 0.9f, 0.78f), 1.3f, false, ETCUiFont::Title);
		Text(TEXT("waiting for an opponent..."), X, Y0 + 64.f * U, Dim, 0.85f, false, ETCUiFont::SansLight);
		Button(TEXT("leave"), TEXT("Leave table"), X, Y0 + 110.f * U, W, ETCButton::Boxed);
		return;
	}
	FString LevelLabel = Level;
	for (const FTCAiLevel& L : C->GetAiLevels()) if (L.Id == Level) LevelLabel = L.Label;
	const ATCGameMode* GM = GetWorld()->GetAuthGameMode<ATCGameMode>();
	const ATCPlayerController* PC = Cast<ATCPlayerController>(GetOwningPlayerController());
	float Y = Y0;
	Button(TEXT("casual"), TEXT("Casual"), X, Y, W, ETCButton::Boxed); Y += Step;
	Button(TEXT("private"), TEXT("Private Match"), X, Y, W, ETCButton::Plain); Y += Step;
	Button(TEXT("join"), PC && PC->bTypingCode ? FString::Printf(TEXT("Code: %s_   (Enter)"), *PC->JoinCode) : TEXT("Join by Code"), X, Y, W, ETCButton::Plain); Y += Step;
	Button(TEXT("cpu_w"), TEXT("Play vs AI  (White)"), X, Y, W, ETCButton::Plain); Y += Step;
	Button(TEXT("cpu_b"), TEXT("Play vs AI  (Black)"), X, Y, W, ETCButton::Plain); Y += Step * 1.35f;
	Button(TEXT("casual"), TEXT("Find Match"), X, Y, W, ETCButton::Primary); Y += Step * 1.6f;
	// options: label on the left, the value in a small box that cycles on click
	const auto Option = [&](const FString& Id, const FString& Label, const FString& Value)
	{
		Text(Label, X + 12.f * U, Y + 6.f * U, Dim, 0.85f);
		Button(Id, Value, X + 150.f * U, Y, W - 150.f, ETCButton::Boxed);
		Y += Step;
	};
	Option(TEXT("tc"), TEXT("Time Control"), TimeControl == TEXT("untimed") ? TEXT("Untimed") : TimeControl.Replace(TEXT("+"), TEXT(" + ")));
	Option(TEXT("level"), TEXT("Strength"), LevelLabel);
	if (GM) Option(TEXT("opponent"), TEXT("Opponent"), OpponentName(GM->GetOpponent()));
}

void ATCHUD::DrawGame(UTCCoreClient* C)
{
	const FTCGameState& S = C->GetState();
	const FString Me = C->GetMyColor();
	const FString Them = Me == TEXT("w") ? TEXT("b") : TEXT("w");
	const FTCPlayer& MeP = Me == TEXT("w") ? S.White : S.Black;
	const FTCPlayer& ThemP = Me == TEXT("w") ? S.Black : S.White;
	const FLinearColor Ink(0.9f, 0.86f, 0.78f), Dim(0.6f, 0.56f, 0.5f);
	const float U = Ui();
	// player plates as in the reference: a dark translucent card (name, rating), the clock in thin numerals under it
	const auto PlayerPlate = [&](const FTCPlayer& P, const FString& Col, float X, bool bRight)
	{
		const ATCGameMode* GM = GetWorld()->GetAuthGameMode<ATCGameMode>();
		const FString Name = P.AiLevel.IsEmpty() ? P.Username : OpponentName(GM ? GM->GetOpponent() : FString());
		FString Sub = Col == TEXT("w") ? TEXT("White") : TEXT("Black");
		if (P.Rating >= 0) Sub += FString::Printf(TEXT("   %d"), P.Rating);
		if (!P.AiLevel.IsEmpty()) Sub += TEXT("   ") + P.AiLevel;
		const float W = FMath::Max(230.f * U, FMath::Max(TextWidth(Name, 0.95f), TextWidth(Sub, 0.78f)) + 32.f * U);
		const float Bx = bRight ? X - W : X;
		Plate(Bx, 22.f * U, W, 62.f * U, 0.6f, 0.0f);
		DrawRect(FLinearColor(0.62f, 0.55f, 0.42f, 0.35f), Bx, 22.f * U + 62.f * U - 1.f, W, 1.f);
		Text(Name, Bx + 16.f * U, 28.f * U, Ink, 0.95f);
		Text(Sub, Bx + 16.f * U, 55.f * U, Dim, 0.78f, false, ETCUiFont::SansLight);
		const bool bRun = S.IsActive() && S.Turn == Col;
		if (S.IsTimed()) Text(ClockText(C->GetDisplayClockMs(Col)), Bx + W * 0.5f, 92.f * U, bRun ? FLinearColor(1.f, 0.95f, 0.85f) : Dim, 1.9f, true, ETCUiFont::SansLight);
	};
	PlayerPlate(MeP, Me, 30.f * U, false);
	PlayerPlate(ThemP, Them, Canvas->ClipX - 30.f * U, true);

	FString Status;
	ATCPlayerController* PC = Cast<ATCPlayerController>(GetOwningPlayerController());
	ATCBoard* B = PC ? PC->Board() : nullptr;
	if (S.IsFinished()) Status = ResultText(S, Me);
	else if (B && B->IsAwaitingCore()) Status = TEXT("...");
	else if (C->IsMyTurn()) Status = TEXT("Your move");
	else if (ThemP.AiLevel.IsEmpty()) Status = TEXT("Opponent to move");
	else
	{
		const ATCGameMode* GM = GetWorld()->GetAuthGameMode<ATCGameMode>();
		Status = GM && GM->GetOpponent() == TEXT("annotator") ? TEXT("The Annotator is writing...") : TEXT("The patient is thinking...");
	}
	bool bCheck = false;
	for (const FTCGameEvent& E : S.LastEvents) if (E.Type == TEXT("check") && S.IsActive()) bCheck = true;
	if (S.IsFinished())
	{
		// the reference's end card: a large red title, a quiet line under it
		const bool bMate = S.Status == TEXT("checkmate");
		Text(bMate ? TEXT("CHECKMATE") : S.Status.ToUpper(), Canvas->ClipX * 0.5f, Canvas->ClipY * 0.36f, FLinearColor(0.75f, 0.1f, 0.07f), 2.6f, true, ETCUiFont::Title);
		Text(Status, Canvas->ClipX * 0.5f, Canvas->ClipY * 0.36f + 64.f * U, Ink, 1.1f, true);
	}
	else
	{
		if (bCheck) Text(TEXT("CHECK"), Canvas->ClipX * 0.5f, Canvas->ClipY - 100.f * U, FLinearColor(0.8f, 0.16f, 0.1f), 1.2f, true, ETCUiFont::Title);
		Text(Status, Canvas->ClipX * 0.5f, Canvas->ClipY - 62.f * U, Ink, 0.95f, true, ETCUiFont::SansLight);
	}
	// the opening and the moves live on the clipboard (Tab), not across the top of the screen
	if (!S.OpeningName.IsEmpty() && bScreenRecord) Text(FString::Printf(TEXT("%s  %s"), *S.OpeningEco, *S.OpeningName), Canvas->ClipX * 0.5f, 64.f * U, Dim, 0.85f, true);
	Text(TEXT("Tab   game record"), Canvas->ClipX - 30.f * U - TextWidth(TEXT("Tab   game record"), 0.75f), Canvas->ClipY - 40.f * U, FLinearColor(0.55f, 0.52f, 0.47f, 0.85f), 0.75f, false, ETCUiFont::SansLight);
	if (S.Disconnected.Contains(Them)) Text(TEXT("Opponent disconnected - waiting"), Canvas->ClipX * 0.5f, 120.f * U, FLinearColor(0.9f, 0.6f, 0.3f), 0.9f, true);

	// the reference's quiet action list at the left, mid height
	const float AX = 26.f * U, Step = 40.f * U, AW = 220.f;
	float Y = Canvas->ClipY * 0.42f;
	if (S.IsActive())
	{
		if (!S.DrawOfferBy.IsEmpty() && S.DrawOfferBy != Me)
		{
			Text(TEXT("Your opponent offers a draw"), AX + 12.f * U, Y, Ink, 0.85f); Y += 30.f * U;
			Button(TEXT("accept"), TEXT("Accept Draw"), AX, Y, AW, ETCButton::Boxed); Y += Step;
			Button(TEXT("decline"), TEXT("Decline"), AX, Y, AW); Y += Step * 1.3f;
		}
		else { Button(TEXT("offer"), S.DrawOfferBy == Me ? TEXT("Draw Offered") : TEXT("Offer Draw"), AX, Y, AW); Y += Step; }
		if (!S.ClaimableDraw.IsEmpty() && C->IsMyTurn()) { Button(TEXT("claim"), FString::Printf(TEXT("Claim Draw (%s)"), *S.ClaimableDraw), AX, Y, AW, ETCButton::Boxed); Y += Step; }
		Button(TEXT("resign"), bConfirmResign ? TEXT("Click again to resign") : TEXT("Resign"), AX, Y, AW, bConfirmResign ? ETCButton::Boxed : ETCButton::Plain);
	}
	else if (S.IsFinished())
	{
		const float Cx = Canvas->ClipX * 0.5f - 130.f * U, Cy = Canvas->ClipY * 0.36f + 110.f * U;
		Button(TEXT("rematch"), S.RematchOfferBy.IsEmpty() ? TEXT("Rematch") : (S.RematchOfferBy == Me ? TEXT("Rematch offered") : TEXT("Accept Rematch")), Cx, Cy, 260.f, ETCButton::Primary);
		Button(TEXT("leave"), TEXT("Leave Table"), Cx, Cy + Step * 1.2f, 260.f, ETCButton::Boxed);
	}
	if (B && B->HasPendingPromotion())
	{
		// the reference's PROMOTION card: title, "Choose a piece:", four square choices
		const float Bw = 92.f * U, Gap = 10.f * U, Cw = 4.f * Bw + 3.f * Gap + 40.f * U;
		const float Cx = Canvas->ClipX * 0.5f - Cw * 0.5f, Cy = Canvas->ClipY * 0.42f;
		Plate(Cx, Cy, Cw, 150.f * U, 0.78f, 0.4f);
		Text(TEXT("PROMOTION"), Cx + 20.f * U, Cy + 14.f * U, Ink, 1.1f, false, ETCUiFont::Title);
		Text(TEXT("Choose a piece:"), Cx + 20.f * U, Cy + 50.f * U, Dim, 0.8f, false, ETCUiFont::SansLight);
		const TCHAR* Ids[] = {TEXT("promo_q"), TEXT("promo_r"), TEXT("promo_b"), TEXT("promo_n")};
		const TCHAR* Names[] = {TEXT("Queen"), TEXT("Rook"), TEXT("Bishop"), TEXT("Knight")};
		for (int32 k = 0; k < 4; ++k) Button(Ids[k], Names[k], Cx + 20.f * U + k * (Bw + Gap), Cy + 84.f * U, 92.f, ETCButton::Boxed);
	}
}
