#include "TCClipboard.h"

#include "CineCameraActor.h"
#include "CineCameraComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Canvas.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Engine/FontFace.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TCCoreClient.h"
#include "TCLog.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr int32 SheetW = 1024, SheetH = 1365;   // 20 x 26.7 cm of paper (fills the clipboard under the clip)
	constexpr int32 Rows = 15, PliesPerPage = Rows * 2 * 2;
	const FLinearColor PaperInk(0.13f, 0.12f, 0.12f), Pencil(0.22f, 0.21f, 0.23f), Rule(0.55f, 0.5f, 0.42f), Faded(0.42f, 0.38f, 0.32f);
}

ATCClipboard::ATCClipboard()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;
	Root->SetMobility(EComponentMobility::Movable);
	Board = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Board"));
	Board->SetupAttachment(Root);
	Board->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Paper = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Paper"));
	Paper->SetupAttachment(Root);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Plane(TEXT("/Engine/BasicShapes/Plane.Plane"));
	if (Plane.Succeeded()) Paper->SetStaticMesh(Plane.Object);
	Paper->SetRelativeScale3D(FVector(0.20f, 0.267f, 1.f));  // the engine plane is 100 x 100 cm
	Paper->SetRelativeLocation(FVector(0.f, 1.6f, 0.45f));
	Paper->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	ReadLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("ReadLight"));
	ReadLight->SetupAttachment(Root);
	ReadLight->SetRelativeLocation(FVector(0.f, 0.f, 22.f));
	ReadLight->SetIntensityUnits(ELightUnits::Lumens);
	ReadLight->SetIntensity(0.f);
	ReadLight->SetAttenuationRadius(60.f);
	ReadLight->SetLightColor(FLinearColor(1.f, 0.82f, 0.6f));
	ReadLight->SetCastShadows(false);
}

static UFont* RuntimeFont(UObject* Outer, UFontFace* Face, int32 Size)
{
	if (!Face) return nullptr;
	UFont* F = NewObject<UFont>(Outer);
	F->FontCacheType = EFontCacheType::Runtime;
	F->LegacyFontSize = Size;
	FTypefaceEntry& E = F->GetMutableInternalCompositeFont().DefaultTypeface.Fonts.AddDefaulted_GetRef();
	E.Name = TEXT("Regular");
	E.Font = FFontData(Face);
	return F;
}

void ATCClipboard::BeginPlay()
{
	Super::BeginPlay();
	if (!HandFont) HandFont = RuntimeFont(this, HandFace, 32);
	if (!FormFont) FormFont = RuntimeFont(this, FormFace, 28);
	Rest = GetActorTransform();
	Sheet = Cast<UCanvasRenderTarget2D>(UCanvasRenderTarget2D::CreateCanvasRenderTarget2D(this, UCanvasRenderTarget2D::StaticClass(), SheetW, SheetH));
	if (Sheet)
	{
		Sheet->OnCanvasRenderTargetUpdate.AddDynamic(this, &ATCClipboard::DrawSheet);
		Sheet->UpdateResource();
	}
	if (PaperMaterial)
	{
		PaperMID = UMaterialInstanceDynamic::Create(PaperMaterial, this);
		PaperMID->SetTextureParameterValue(TEXT("Sheet"), Sheet);
		Paper->SetMaterial(0, PaperMID);
	}
	if (UTCCoreClient* C = GetGameInstance()->GetSubsystem<UTCCoreClient>())
	{
		C->OnState.AddDynamic(this, &ATCClipboard::OnState);
		if (C->HasGame()) Rebuild(C->GetState());
	}
}

void ATCClipboard::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UGameInstance* GI = GetGameInstance())
	{
		if (UTCCoreClient* C = GI->GetSubsystem<UTCCoreClient>()) C->OnState.RemoveAll(this);
	}
	Super::EndPlay(Reason);
}

void ATCClipboard::OnState(const FTCGameState& State, const FString& Reason)
{
	Rebuild(State);
	if (State.IsFinished() && Reason != TEXT("joined")) SetRaised(true);  // the record is the natural end-of-game read
}

void ATCClipboard::Rebuild(const FTCGameState& S)
{
	SheetLines.Reset();
	for (int32 i = 0; i < S.History.Num(); i += 2)
	{
		const FString Black = S.History.IsValidIndex(i + 1) ? S.History[i + 1].San : FString();
		SheetLines.Add(FString::Printf(TEXT("%d. %s  %s"), i / 2 + 1, *S.History[i].San, *Black).TrimEnd());
	}
	OpeningLine = S.OpeningName;
	const auto Name = [](const FTCPlayer& P) { return P.AiLevel.IsEmpty() ? P.Username : FString::Printf(TEXT("(%s)"), *P.AiLevel); };
	WhiteName = Name(S.White);
	BlackName = Name(S.Black);
	ResultLine = S.IsFinished() ? (S.Winner == TEXT("w") ? TEXT("1-0") : S.Winner == TEXT("b") ? TEXT("0-1") : TEXT("1/2-1/2")) + FString(TEXT("  ")) + S.Termination : FString();
	Page = FMath::Max(0, (S.History.Num() - 1) / PliesPerPage);
	if (Sheet) Sheet->UpdateResource();
}

void ATCClipboard::DrawSheet(UCanvas* Canvas, int32 Width, int32 Height)
{
	UFont* Hand = HandFont ? HandFont.Get() : GEngine->GetLargeFont();
	UFont* Form = FormFont ? FormFont.Get() : GEngine->GetMediumFont();
	Canvas->K2_DrawTexture(nullptr, FVector2D::ZeroVector, FVector2D(Width, Height), FVector2D::ZeroVector, FVector2D::UnitVector,
		FLinearColor(0.80f, 0.74f, 0.60f), BLEND_Opaque);
	const auto Text = [&](UFont* F, const FString& S, float X, float Y, float Scale, const FLinearColor& C)
	{
		FCanvasTextItem Item(FVector2D(X, Y), FText::FromString(S), F, C);
		Item.Scale = FVector2D(Scale, Scale);
		Canvas->DrawItem(Item);
	};
	const auto Line = [&](float X0, float Y0, float X1, float Y1, const FLinearColor& C, float T = 2.f)
	{
		Canvas->K2_DrawLine(FVector2D(X0, Y0), FVector2D(X1, Y1), T, C);
	};
	const float M = 60.f;
	Text(Form, TEXT("WARD B"), M, 40.f, 2.0f, PaperInk);
	Text(Form, FString::Printf(TEXT("GAME RECORD   Form 7/C   Sheet %d"), Page + 1), M + 330.f, 66.f, 0.95f, Faded);
	Line(M, 120.f, Width - M, 120.f, PaperInk, 3.f);
	Text(Form, TEXT("WHITE"), M, 140.f, 0.9f, Faded);
	Text(Hand, WhiteName, M + 120.f, 128.f, 1.25f, Pencil);
	Text(Form, TEXT("BLACK"), Width * 0.52f, 140.f, 0.9f, Faded);
	Text(Hand, BlackName, Width * 0.52f + 120.f, 128.f, 1.25f, Pencil);
	Line(M, 190.f, Width - M, 190.f, Rule);
	Text(Form, TEXT("OPENING"), M, 208.f, 0.9f, Faded);
	FString Op1 = OpeningLine, Op2;
	if (!OpeningLine.Split(TEXT(": "), &Op1, &Op2)) Op2.Reset();  // long names split at the colon onto two lines
	Text(Hand, Op1, M + 170.f, 196.f, 1.25f, Pencil);
	if (!Op2.IsEmpty()) Text(Hand, Op2, M + 170.f, 246.f, 1.1f, Pencil);
	Line(M, 300.f, Width - M, 300.f, PaperInk, 3.f);
	// two columns of 15 rows; each row holds one full move ("12. Nf3  Nc6")
	const float Top = 330.f, RowH = 62.f, ColW = (Width - 2 * M) / 2.f;
	for (int32 r = 0; r <= Rows; ++r) Line(M, Top + r * RowH + RowH - 6.f, Width - M, Top + r * RowH + RowH - 6.f, Rule, 1.5f);
	Line(M + ColW, Top, M + ColW, Top + Rows * RowH + RowH, Rule, 1.5f);
	const int32 First = Page * Rows * 2;
	for (int32 i = 0; i < Rows * 2; ++i)
	{
		const int32 Idx = First + i;
		if (!SheetLines.IsValidIndex(Idx)) break;
		const float X = M + (i / Rows) * ColW + 14.f, Y = Top + (i % Rows) * RowH + 4.f;
		Text(Hand, SheetLines[Idx], X, Y, 1.4f, Pencil);
	}
	if (!ResultLine.IsEmpty()) Text(Hand, TEXT("Result: ") + ResultLine, M, Top + Rows * RowH + RowH + 20.f, 1.3f, PaperInk);
}

FTransform ATCClipboard::RaisedTransform() const
{
	const APlayerCameraManager* Cam = UGameplayStatics::GetPlayerCameraManager(this, 0);
	if (!Cam) return Rest;
	const FRotator R = Cam->GetCameraRotation();
	const FVector Fwd = R.Vector(), Right = FRotationMatrix(R).GetUnitAxis(EAxis::Y), Up = FRotationMatrix(R).GetUnitAxis(EAxis::Z);
	const FVector Loc = Cam->GetCameraLocation() + Fwd * RaisedOffset.X + Right * RaisedOffset.Y + Up * RaisedOffset.Z;
	// paper faces the camera (+Z towards the eye) with its clip edge (-Y) at the top of the screen
	return FTransform(FRotationMatrix::MakeFromZY(-Fwd, -Up).Rotator(), Loc, Rest.GetScale3D());
}

void ATCClipboard::Toggle() { SetRaised(!bRaised); }

void ATCClipboard::SetRaised(bool bRaise)
{
	bRaised = bRaise;
	UE_LOG(LogTownChess, Log, TEXT("clipboard %s (%d moves)"), bRaised ? TEXT("raised") : TEXT("lowered"), SheetLines.Num());
}

void ATCClipboard::Tick(float Dt)
{
	Super::Tick(Dt);
	const float Target = bRaised ? 1.f : 0.f;
	if (Alpha <= 0.f && !bRaised)
	{
		Rest = GetActorTransform();  // resting: follow the seat mirroring (the cart moves to Black's right)
		return;
	}
	Alpha = FMath::FInterpConstantTo(Alpha, Target, Dt, 1.f / FMath::Max(RaiseSeconds, 0.05f));
	const float A = FMath::SmoothStep(0.f, 1.f, Alpha);
	FTransform T;
	T.Blend(Rest, RaisedTransform(), A);
	SetActorTransform(T);
	ReadLight->SetIntensity(A * 35.f);
	// the camera is focused on the board at f/2.8: pull focus to the sheet while it is up, then give it back
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		if (ACineCameraActor* Cine = Cast<ACineCameraActor>(PC->GetViewTarget()))
		{
			FCameraFocusSettings& F = Cine->GetCineCameraComponent()->FocusSettings;
			if (SavedFocus < 0.f) SavedFocus = F.ManualFocusDistance;
			F.ManualFocusDistance = FMath::Lerp(SavedFocus, RaisedOffset.X, A);
		}
	}
}
