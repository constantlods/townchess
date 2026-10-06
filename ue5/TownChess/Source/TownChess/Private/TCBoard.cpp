#include "TCBoard.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TCCoreClient.h"
#include "TCLog.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	const FLinearColor SelectedColor(0.95f, 0.72f, 0.25f);
	const FLinearColor MoveColor(0.55f, 0.48f, 0.32f);
	const FLinearColor CaptureColor(0.75f, 0.18f, 0.12f);
	const FLinearColor LastMoveColor(0.32f, 0.30f, 0.22f);
	const FLinearColor CheckColor(0.9f, 0.08f, 0.05f);
}

ATCBoard::ATCBoard()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
	BoardComp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("BoardMesh"));
	BoardComp->SetupAttachment(Root);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> ShapeMat(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	MarkerMesh = Cylinder.Object;
	MarkerMaterial = ShapeMat.Object;
}

void ATCBoard::DestroyPiece(FTCPieceVisual& P)
{
	// destroy the mesh explicitly: DestroyComponent(true) on the root would promote it instead of removing it
	if (P.Mesh) P.Mesh->DestroyComponent();
	if (P.Root) P.Root->DestroyComponent();
	P.Mesh = nullptr;
	P.Root = nullptr;
}

UTCCoreClient* ATCBoard::Core() const
{
	const UGameInstance* GI = GetGameInstance();
	return GI ? GI->GetSubsystem<UTCCoreClient>() : nullptr;
}

void ATCBoard::BeginPlay()
{
	Super::BeginPlay();
	if (BoardMesh)
	{
		BoardComp->SetStaticMesh(BoardMesh);
		const FVector C = BoardMesh->GetBoundingBox().GetCenter();
		const FRotator Yaw(0, BoardMeshYaw, 0);
		BoardComp->SetRelativeRotation(Yaw);
		BoardComp->SetRelativeLocation(-Yaw.RotateVector(FVector(C.X, C.Y, 0)));
	}
	if (UTCCoreClient* C = Core())
	{
		C->OnState.AddDynamic(this, &ATCBoard::OnCoreState);
		C->OnMoveRejected.AddDynamic(this, &ATCBoard::OnCoreRejected);
		if (C->HasGame()) Rebuild(C->GetState());
	}
}

void ATCBoard::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UTCCoreClient* C = Core()) { C->OnState.RemoveAll(this); C->OnMoveRejected.RemoveAll(this); }
	Super::EndPlay(Reason);
}

float ATCBoard::SurfaceZ() const
{
	float Base = 0.f;
	bool bAny = false;
	for (const auto& KV : PieceMeshes)
	{
		if (!KV.Value) continue;
		const float Z = KV.Value->GetBoundingBox().Min.Z;
		Base = bAny ? FMath::Min(Base, Z) : Z;
		bAny = true;
	}
	return GetActorLocation().Z + Base;
}

FVector ATCBoard::LocalOf(const FString& Square) const
{
	int32 F, R;
	if (!TCProtocol::SquareToFileRank(Square, F, R)) return FVector::ZeroVector;
	return FVector((R - 3.5f) * SquareSize, (F - 3.5f) * SquareSize, 0.f);
}

FVector ATCBoard::SquareWorld(const FString& Square) const
{
	return GetActorTransform().TransformPosition(LocalOf(Square));
}

FString ATCBoard::SquareAtWorld(const FVector& World) const
{
	const FVector L = GetActorTransform().InverseTransformPosition(World);
	const int32 F = FMath::FloorToInt32(L.Y / SquareSize + 4.f);
	const int32 R = FMath::FloorToInt32(L.X / SquareSize + 4.f);
	return F >= 0 && F < 8 && R >= 0 && R < 8 ? TCProtocol::FileRankToSquare(F, R) : FString();
}

void ATCBoard::SetPieceMesh(FTCPieceVisual& P, const FString& Code)
{
	P.Code = Code;
	ApplyPieceMesh(P.Root, P.Mesh, Code);
}

void ATCBoard::ApplyPieceMesh(USceneComponent* PieceRoot, UStaticMeshComponent* MeshComp, const FString& Code)
{
	if (!PieceRoot || !MeshComp) return;
	UStaticMesh* Mesh = PieceMeshes.FindRef(Code);
	MeshComp->SetStaticMesh(Mesh);
	if (Mesh)
	{
		// meshes are baked at their original square: re-centre on the piece's own vertical axis
		const FVector C = Mesh->GetBoundingBox().GetCenter();
		MeshComp->SetRelativeLocation(FVector(-C.X, -C.Y, 0.f));
	}
	PieceRoot->SetRelativeRotation(FRotator(0, Code.StartsWith(TEXT("w")) ? WhitePieceYaw : BlackPieceYaw, 0));
}

FTCPieceVisual ATCBoard::SpawnPiece(const FString& Code, const FVector& Local)
{
	FTCPieceVisual P;
	P.Root = NewObject<USceneComponent>(this);
	P.Root->SetupAttachment(Root);
	P.Root->RegisterComponent();
	P.Root->SetRelativeLocation(Local);
	P.Mesh = NewObject<UStaticMeshComponent>(this);
	P.Mesh->SetupAttachment(P.Root);
	P.Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	P.Mesh->SetReceivesDecals(false);  // blood/wear decals belong to the board; on a piece they stretch into streaks
	P.Mesh->RegisterComponent();
	SetPieceMesh(P, Code);
	return P;
}

FVector ATCBoard::GraveyardSlot(const FString& CapturedColor)
{
	// captured pieces stand in two rows beside the board, on the capturer's right-hand side
	const bool bWhitePiece = CapturedColor == TEXT("w");
	const int32 Index = bWhitePiece ? WhiteCaptured++ : BlackCaptured++;
	const float Side = bWhitePiece ? -1.f : 1.f; // black captures white pieces: set them by Black's right (-Y)
	const float Row = (Index / 8) * SquareSize * 0.9f;
	const float Along = ((Index % 8) - 3.5f) * SquareSize * 0.8f * (bWhitePiece ? 1.f : -1.f);
	return FVector(Along, Side * (4.f * SquareSize + 6.f + Row), 0.f);
}

void ATCBoard::Rebuild(const FTCGameState& State)
{
	for (auto& KV : Pieces) DestroyPiece(KV.Value);
	for (FTCPieceVisual& P : Captured) DestroyPiece(P);
	Pieces.Empty();
	Captured.Empty();
	Anims.Empty();
	WhiteCaptured = BlackCaptured = 0;
	Shown = State;
	if (!State.Id.IsEmpty())
	{
		for (const auto& KV : State.PiecesFromFen()) Pieces.Add(KV.Key, SpawnPiece(KV.Value, LocalOf(KV.Key)));
		// the graveyard is reconstructed from the authoritative history
		for (const FTCMoveRecord& M : State.History)
		{
			for (const FTCMoveEffect& Fx : M.Effects)
			{
				if (Fx.Kind != ETCEffectKind::Capture) continue;
				Captured.Add(SpawnPiece(Fx.Color + Fx.Piece, GraveyardSlot(Fx.Color)));
			}
		}
	}
	ClearSelection();
	RefreshMarkers();
}

void ATCBoard::AnimateMove(const FTCMoveRecord& Move)
{
	++AnimatedMoves;
	const int32 Group = NextGroup++;
	bool bCapture = false;
	for (const FTCMoveEffect& Fx : Move.Effects) bCapture |= Fx.Kind == ETCEffectKind::Capture;
	for (const FTCMoveEffect& Fx : Move.Effects)
	{
		if (Fx.Kind == ETCEffectKind::Capture)
		{
			FTCPieceVisual P;
			if (!Pieces.RemoveAndCopyValue(Fx.From, P) || !P.Root) continue;
			FAnim A;
			A.Target = P.Root;
			A.From = LocalOf(Fx.From); // not the current location: an earlier queued move may still be carrying it there
			A.To = GraveyardSlot(Fx.Color);
			A.Duration = MoveSeconds * 1.2f;
			A.Lift = LiftHeight * 2.f;
			A.Delay = MoveSeconds * 0.8f;  // leaves as the capturing piece lands
			A.Group = Group;
			Anims.Add(A);
			Captured.Add(P);
		}
		else if (Fx.Kind == ETCEffectKind::Move)
		{
			FTCPieceVisual P;
			if (!Pieces.RemoveAndCopyValue(Fx.From, P) || !P.Root) continue;
			FAnim A;
			A.Target = P.Root;
			A.From = LocalOf(Fx.From);
			A.To = LocalOf(Fx.To);
			A.Duration = MoveSeconds;
			A.Lift = Fx.Piece == TEXT("n") ? LiftHeight * 1.6f : LiftHeight;
			if (!DroppedFrom.IsEmpty() && DroppedFrom == Fx.From && P.Root)
			{
				// the player dropped this piece on its square: settle from where the hand left it, no second flight
				A.From = P.Root->GetRelativeLocation();
				A.Duration = DropSettleSeconds;
				A.Lift = 0.f;
				DroppedFrom.Empty();
			}
			A.Group = Group;
			A.Sound = bCapture ? CaptureSound.Get() : MoveSound.Get();
			Anims.Add(A);
			Pieces.Add(Fx.To, P);
		}
		else // Promote: the logical piece changes now; its mesh swaps once it has landed
		{
			FTCPieceVisual* P = Pieces.Find(Fx.From);
			if (!P) continue;
			P->Code = Fx.Color + Fx.Piece;
			FAnim A;
			A.Duration = 0.f;
			A.PromoteRoot = P->Root;
			A.PromoteMesh = P->Mesh;
			A.PromoteCode = P->Code;
			Anims.Add(A);
		}
	}
}

void ATCBoard::Tick(float Dt)
{
	Super::Tick(Dt);
	if (Anims.Num() == 0) return;
	// every effect of the front move's group plays at once (mover and capture together)
	const int32 G = Anims[0].Group;
	for (int32 i = 0; i < Anims.Num() && Anims[i].Group == G; ++i)
	{
		FAnim& A = Anims[i];
		if (!A.PromoteCode.IsEmpty())
		{
			bool bOthers = false;  // the promotion swap waits until the pawn has landed
			for (int32 j = 0; j < i; ++j) bOthers |= Anims[j].Group == G && Anims[j].PromoteCode.IsEmpty() && Anims[j].T < 1.f;
			if (!bOthers) { ApplyPieceMesh(A.PromoteRoot.Get(), A.PromoteMesh.Get(), A.PromoteCode); A.T = 1.f; }
			continue;
		}
		if (A.Delay > 0.f) { A.Delay -= Dt; continue; }
		const bool bWasRunning = A.T < 1.f;
		A.T = FMath::Min(1.f, A.T + Dt / FMath::Max(A.Duration, 0.01f));
		const float E = 1.f - FMath::Pow(1.f - A.T, 3.f);  // ease-out: quick start, soft landing
		if (A.Target.IsValid()) A.Target->SetRelativeLocation(FMath::Lerp(A.From, A.To, E) + FVector(0, 0, A.Lift * FMath::Sin(PI * E)));
		if (bWasRunning && A.T >= 1.f && A.Sound && A.Target.IsValid()) UGameplayStatics::PlaySoundAtLocation(this, A.Sound, A.Target->GetComponentLocation(), 0.8f);
	}
	Anims.RemoveAll([G](const FAnim& A) { return A.Group == G && A.T >= 1.f && A.Delay <= 0.f; });
	if (Anims.Num() == 0)
	{
		// the shown board must equal the authority; if it ever does not, the authority wins
		if (!IsInSync())
		{
			++Resyncs; // automation asserts this stays 0: a silent repair must never hide an animation bug
			UE_LOG(LogTownChess, Warning, TEXT("board diverged from the authoritative FEN after a move: rebuilding"));
			if (const UTCCoreClient* C = Core()) Rebuild(C->GetState());
		}
		RefreshMarkers();
	}
}

void ATCBoard::OnCoreState(const FTCGameState& State, const FString& Reason)
{
	const bool bNewGame = State.Id != Shown.Id || Reason == TEXT("joined");
	if (bNewGame)
	{
		Rebuild(State);
	}
	else if (State.History.Num() == Shown.History.Num() + 1)
	{
		// exactly one new authoritative move: animate it (this is the only path that moves pieces)
		Shown = State;
		AnimateMove(State.History.Last());
		ClearSelection();
	}
	else if (State.History.Num() != Shown.History.Num() || (State.History.Num() > 0 && Shown.History.Num() > 0 && State.History.Last().FenAfter != Shown.History.Last().FenAfter))
	{
		++Resyncs;
		Rebuild(State); // missed or reordered updates: take the authority as-is
	}
	else
	{
		Shown = State; // offers, clocks, results: no board change
	}
	if (!State.IsActive()) { Selected.Empty(); PromotionFrom.Empty(); PromotionTo.Empty(); } // no pickers on a finished game
	PendingRequest = false;
	RefreshMarkers();
}

void ATCBoard::OnCoreRejected(const FString& Reason)
{
	if (!DroppedFrom.IsEmpty()) { SnapBack(DroppedFrom); DroppedFrom.Empty(); }
	// the core said no: nothing moves; drop the selection and wait for the next input
	PendingRequest = false;
	ClearSelection();
}

ETCClickResult ATCBoard::ClickSquare(const FString& Square)
{
	UTCCoreClient* C = Core();
	if (!C || !C->IsMyTurn() || PendingRequest || !PromotionFrom.IsEmpty()) return ETCClickResult::Ignored;
	if (Anims.Num() > 0) FinishAnims();
	const FString Mine = C->GetMyColor();
	const FTCPieceVisual* At = Pieces.Find(Square);
	const bool bOwn = At && At->Code.StartsWith(Mine);
	if (Selected.IsEmpty() || bOwn)
	{
		if (!bOwn) return ETCClickResult::Ignored;
		if (Selected == Square) { ClearSelection(); return ETCClickResult::Deselected; }
		Selected = Square;
		RefreshMarkers();
		return ETCClickResult::Selected;
	}
	// destination: only moves the core listed as legal are ever offered or sent from the board
	TArray<FString> Matching;
	for (const FString& M : C->GetState().LegalMoves) if (M.StartsWith(Selected + Square)) Matching.Add(M);
	if (Matching.Num() == 0) { ClearSelection(); return ETCClickResult::Deselected; }
	if (Matching[0].Len() == 5)
	{
		PromotionFrom = Selected;
		PromotionTo = Square;
		RefreshMarkers();
		return ETCClickResult::NeedsPromotion;
	}
	C->SubmitMove(Selected, Square);
	PendingRequest = true; // the piece stays where it is until the core accepts
	return ETCClickResult::Submitted;
}

bool ATCBoard::ChoosePromotion(const FString& Piece)
{
	UTCCoreClient* C = Core();
	if (!C || PromotionFrom.IsEmpty()) return false;
	if (!C->IsMyTurn() || Piece.IsEmpty())
	{
		// cancelled: a pawn dragged to the last rank goes home (BUG-008: it stayed drawn on the promotion square)
		if (!DroppedFrom.IsEmpty()) { SnapBack(DroppedFrom); DroppedFrom.Empty(); }
		PromotionFrom.Empty(); PromotionTo.Empty(); ClearSelection(); return false;
	}
	C->SubmitMove(PromotionFrom, PromotionTo, Piece.Left(1).ToLower());
	PromotionFrom.Empty();
	PromotionTo.Empty();
	PendingRequest = true;
	return true;
}

void ATCBoard::ClearSelection()
{
	Selected.Empty();
	PromotionFrom.Empty();
	PromotionTo.Empty();
	RefreshMarkers();
}

TMap<FString, FString> ATCBoard::GetShownLayout() const
{
	TMap<FString, FString> Out;
	for (const auto& KV : Pieces) Out.Add(KV.Key, KV.Value.Code);
	return Out;
}

bool ATCBoard::IsInSync() const
{
	const UTCCoreClient* C = Core();
	if (!C) return false;
	const TMap<FString, FString> Want = C->GetState().PiecesFromFen();
	if (Want.Num() != Pieces.Num()) return false;
	for (const auto& KV : Want)
	{
		const FTCPieceVisual* P = Pieces.Find(KV.Key);
		if (!P || P->Code != KV.Value) return false;
	}
	return true;
}

int32 ATCBoard::GetPhysicalMismatches() const
{
	// where the pieces really are, not just the bookkeeping: every piece root must sit on its square's centre
	int32 Bad = 0;
	for (const auto& KV : Pieces)
	{
		if (!KV.Value.Root || !FVector::PointsAreNear(KV.Value.Root->GetRelativeLocation(), LocalOf(KV.Key), 0.01f)) ++Bad;
	}
	return Bad;
}

TArray<FString> ATCBoard::GetMarkedSquares() const
{
	TArray<FString> Out;
	for (const UStaticMeshComponent* M : Markers) if (M) Out.Add(SquareAtWorld(M->GetComponentLocation()));
	return Out;
}

UStaticMeshComponent* ATCBoard::AddMarker(const FVector& Local, const FLinearColor& Color, float Radius, float Height)
{
	UMaterialInterface* Mat = MarkerMaterial;
	UStaticMeshComponent* M = NewObject<UStaticMeshComponent>(this);
	M->SetupAttachment(Root);
	M->SetStaticMesh(MarkerMesh);
	M->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	M->SetCastShadow(false);
	M->RegisterComponent();
	const float Base = SurfaceZ() - GetActorLocation().Z;
	M->SetRelativeLocation(Local + FVector(0, 0, Base + Height * 0.5f));
	M->SetRelativeScale3D(FVector(Radius * 2.f / 100.f, Radius * 2.f / 100.f, Height / 100.f));
	if (Mat)
	{
		UMaterialInstanceDynamic* D = UMaterialInstanceDynamic::Create(Mat, this);
		D->SetVectorParameterValue(TEXT("Color"), Color);
		M->SetMaterial(0, D);
	}
	Markers.Add(M);
	return M;
}

void ATCBoard::RefreshMarkers()
{
	for (UStaticMeshComponent* M : Markers) if (M) M->DestroyComponent();
	Markers.Empty();
	const UTCCoreClient* C = Core();
	if (!C || !C->HasGame() || Anims.Num() > 0) return;
	const FTCGameState& S = C->GetState();
	if (S.History.Num() > 0)
	{
		AddMarker(LocalOf(S.History.Last().From), LastMoveColor, SquareSize * 0.46f, 0.08f);
		AddMarker(LocalOf(S.History.Last().To), LastMoveColor, SquareSize * 0.46f, 0.08f);
	}
	for (const FTCGameEvent& E : S.LastEvents)
	{
		if (E.Type != TEXT("check") && E.Type != TEXT("checkmate")) continue;
		for (const auto& KV : Pieces) if (KV.Value.Code == S.Turn + TEXT("k")) AddMarker(LocalOf(KV.Key), CheckColor, SquareSize * 0.46f, 0.12f);
	}
	// hover: own pieces you could pick up, or a legal destination of the selected piece
	if (!Hover.IsEmpty() && C->IsMyTurn())
	{
		const FTCPieceVisual* At = Pieces.Find(Hover);
		bool bShow = At && At->Code.StartsWith(C->GetMyColor());
		for (const FString& M : S.LegalMoves) bShow |= !Selected.IsEmpty() && M.StartsWith(Selected + Hover);
		if (bShow && Hover != Selected) AddMarker(LocalOf(Hover), FLinearColor(0.95f, 0.85f, 0.6f, 1.f), SquareSize * 0.47f, 0.06f);
	}
	if (!Selected.IsEmpty())
	{
		AddMarker(LocalOf(Selected), SelectedColor, SquareSize * 0.46f, 0.15f);
		TSet<FString> Dests;
		for (const FString& M : S.LegalMoves) if (M.StartsWith(Selected)) Dests.Add(M.Mid(2, 2));
		for (const FString& D : Dests)
		{
			const bool bCapture = Pieces.Contains(D);
			AddMarker(LocalOf(D), bCapture ? CaptureColor : MoveColor, bCapture ? SquareSize * 0.44f : SquareSize * 0.14f, 0.2f);
		}
	}
}


// ─────────────────────────────── drag and drop ───────────────────────────────

void ATCBoard::FinishAnims()
{
	// the player wants to act now: land every running animation at once (the shown board is already authoritative)
	for (FAnim& A : Anims)
	{
		if (!A.PromoteCode.IsEmpty()) { ApplyPieceMesh(A.PromoteRoot.Get(), A.PromoteMesh.Get(), A.PromoteCode); continue; }
		if (A.Target.IsValid()) A.Target->SetRelativeLocation(A.To);
	}
	Anims.Empty();
	RefreshMarkers();
}

bool ATCBoard::BeginDrag(const FString& Square)
{
	UTCCoreClient* C = Core();
	if (!C || !C->IsMyTurn() || PendingRequest || !PromotionFrom.IsEmpty()) return false;
	if (Anims.Num() > 0) FinishAnims();  // never make the player wait for an animation to grab a piece
	const FTCPieceVisual* At = Pieces.Find(Square);
	if (!At || !At->Root || !At->Code.StartsWith(C->GetMyColor())) return false;
	DragFrom = Square;
	Selected = Square;  // legal destinations show while dragging
	RefreshMarkers();
	return true;
}

void ATCBoard::UpdateDrag(const FVector& WorldOnBoard)
{
	if (DragFrom.IsEmpty()) return;
	const FTCPieceVisual* At = Pieces.Find(DragFrom);
	if (!At || !At->Root) return;
	FVector L = GetActorTransform().InverseTransformPosition(WorldOnBoard);
	L.Z = LocalOf(DragFrom).Z + 2.5f;  // lifted off the board while carried
	At->Root->SetRelativeLocation(L);
}

ETCClickResult ATCBoard::EndDrag(const FString& Square)
{
	const FString From = DragFrom;
	DragFrom.Empty();
	if (From.IsEmpty()) return ETCClickResult::Ignored;
	if (Square.IsEmpty() || Square == From)
	{
		SnapBack(From);  // a press and release on the same square is a click: keep the selection
		return ETCClickResult::Selected;
	}
	Selected = From;
	const ETCClickResult R = ClickSquare(Square);
	// stays where it was dropped until the core answers (or, for a promotion, until the piece is chosen or cancelled)
	if (R == ETCClickResult::Submitted || R == ETCClickResult::NeedsPromotion) DroppedFrom = From;
	else SnapBack(From);
	return R;
}

void ATCBoard::SnapBack(const FString& Square)
{
	const FTCPieceVisual* At = Pieces.Find(Square);
	if (!At || !At->Root) return;
	FAnim A;
	A.Target = At->Root;
	A.From = At->Root->GetRelativeLocation();
	A.To = LocalOf(Square);
	A.Duration = 0.1f;
	A.Lift = 0.f;
	A.Group = NextGroup++;
	Anims.Add(A);
}

void ATCBoard::SetHover(const FString& Square)
{
	if (Square == Hover) return;
	Hover = Square;
	if (Anims.Num() == 0) RefreshMarkers();
}
