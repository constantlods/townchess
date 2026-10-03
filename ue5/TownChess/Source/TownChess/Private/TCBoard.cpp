#include "TCBoard.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TCCoreClient.h"
#include "TCLog.h"

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
	UStaticMesh* Mesh = PieceMeshes.FindRef(Code);
	P.Mesh->SetStaticMesh(Mesh);
	if (Mesh)
	{
		// meshes are baked at their original square: re-centre on the piece's own vertical axis
		const FVector C = Mesh->GetBoundingBox().GetCenter();
		P.Mesh->SetRelativeLocation(FVector(-C.X, -C.Y, 0.f));
	}
	P.Root->SetRelativeRotation(FRotator(0, Code.StartsWith(TEXT("w")) ? WhitePieceYaw : BlackPieceYaw, 0));
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
	for (auto& KV : Pieces) if (KV.Value.Root) KV.Value.Root->DestroyComponent(true);
	for (FTCPieceVisual& P : Captured) if (P.Root) P.Root->DestroyComponent(true);
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
	for (const FTCMoveEffect& Fx : Move.Effects)
	{
		if (Fx.Kind == ETCEffectKind::Capture)
		{
			FTCPieceVisual P;
			if (!Pieces.RemoveAndCopyValue(Fx.From, P) || !P.Root) continue;
			FAnim A;
			A.Target = P.Root;
			A.From = P.Root->GetRelativeLocation();
			A.To = GraveyardSlot(Fx.Color);
			A.Duration = MoveSeconds * 0.8f;
			A.Lift = LiftHeight;
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
			Anims.Add(A);
			Pieces.Add(Fx.To, P);
		}
		else // Promote: swap the piece after it has landed
		{
			FAnim A;
			A.Duration = 0.f;
			A.PromoteSquare = Fx.From;
			A.PromoteCode = Fx.Color + Fx.Piece;
			Anims.Add(A);
		}
	}
}

void ATCBoard::Tick(float Dt)
{
	Super::Tick(Dt);
	if (Anims.Num() == 0) return;
	FAnim& A = Anims[0];
	if (!A.PromoteCode.IsEmpty())
	{
		if (FTCPieceVisual* P = Pieces.Find(A.PromoteSquare)) SetPieceMesh(*P, A.PromoteCode);
		Anims.RemoveAt(0);
	}
	else
	{
		A.T = FMath::Min(1.f, A.T + Dt / FMath::Max(A.Duration, 0.01f));
		const float E = FMath::InterpEaseInOut(0.f, 1.f, A.T, 2.f);
		if (A.Target.IsValid()) A.Target->SetRelativeLocation(FMath::Lerp(A.From, A.To, E) + FVector(0, 0, A.Lift * FMath::Sin(PI * E)));
		if (A.T >= 1.f) Anims.RemoveAt(0);
	}
	if (Anims.Num() == 0)
	{
		// the shown board must equal the authority; if it ever does not, the authority wins
		if (!IsInSync())
		{
			++Resyncs;
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
	PendingRequest = false;
	RefreshMarkers();
}

void ATCBoard::OnCoreRejected(const FString& Reason)
{
	// the core said no: nothing moves; drop the selection and wait for the next input
	PendingRequest = false;
	ClearSelection();
}

ETCClickResult ATCBoard::ClickSquare(const FString& Square)
{
	UTCCoreClient* C = Core();
	if (!C || !C->IsMyTurn() || Anims.Num() > 0 || PendingRequest || !PromotionFrom.IsEmpty()) return ETCClickResult::Ignored;
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
	if (Piece.IsEmpty()) { PromotionFrom.Empty(); PromotionTo.Empty(); ClearSelection(); return false; }
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

TArray<FString> ATCBoard::GetMarkedSquares() const
{
	TArray<FString> Out;
	for (const UStaticMeshComponent* M : Markers) if (M) Out.Add(SquareAtWorld(M->GetComponentLocation()));
	return Out;
}

UStaticMeshComponent* ATCBoard::AddMarker(const FVector& Local, const FLinearColor& Color, float Radius, float Height)
{
	static UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static UMaterialInterface* Mat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	UStaticMeshComponent* M = NewObject<UStaticMeshComponent>(this);
	M->SetupAttachment(Root);
	M->SetStaticMesh(Cylinder);
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
