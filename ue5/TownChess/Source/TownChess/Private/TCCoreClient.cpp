#include "TCCoreClient.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformTime.h"
#include "IWebSocket.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/SecureHash.h"
#include "Modules/ModuleManager.h"
#include "TCLog.h"
#include "WebSocketsModule.h"

void UTCCoreClient::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	if (!FModuleManager::Get().IsModuleLoaded(TEXT("WebSockets"))) FModuleManager::Get().LoadModule(TEXT("WebSockets"));
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UTCCoreClient::TickReconnect), 0.1f);
}

void UTCCoreClient::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
	Disconnect();
	Super::Deinitialize();
}

FString UTCCoreClient::TokenPath() const
{
	// One identity per server. The local core gets a new ephemeral port on every launch, so it is keyed by role, not
	// URL: otherwise a restarted game would come back as a stranger and never rejoin its unfinished game.
	const FString Key = Secret.IsEmpty() ? Url : FString(TEXT("local-core"));
	return FPaths::ProjectSavedDir() / TEXT("TownChess") / FString::Printf(TEXT("token-%s.txt"), *FMD5::HashAnsiString(*Key).Left(12));
}

void UTCCoreClient::Connect(const FString& InUrl, const FString& InSecret, const FString& InUsername)
{
	// idempotent: a second call for the same core (level reload, repeated ready event) keeps the healthy socket
	if (InUrl == Url && InSecret == Secret && bWantConnected && Connection != ETCConnection::Disconnected) return;
	Disconnect();
	Url = InUrl;
	Secret = InSecret;
	Username = InUsername;
	Token.Empty();
	FFileHelper::LoadFileToString(Token, *TokenPath());
	Token.TrimStartAndEndInline();
	bWantConnected = true;
	Backoff = 0.5f;
	Open();
}

void UTCCoreClient::Disconnect()
{
	bWantConnected = false;
	if (Socket.IsValid())
	{
		Socket->OnClosed().Clear();
		Socket->OnConnectionError().Clear();
		Socket->OnMessage().Clear();
		Socket->Close();
		Socket.Reset();
	}
	SetConnection(ETCConnection::Disconnected);
}

void UTCCoreClient::Open()
{
	TMap<FString, FString> Headers;
	if (!Secret.IsEmpty()) Headers.Add(TEXT("x-townchess-secret"), Secret);
	Socket = FWebSocketsModule::Get().CreateWebSocket(Url, TEXT(""), Headers);
	SetConnection(ETCConnection::Connecting);
	TWeakObjectPtr<UTCCoreClient> Weak(this);
	Socket->OnConnected().AddLambda([Weak]()
	{
		if (!Weak.IsValid()) return;
		Weak->SetConnection(ETCConnection::Connected);
		Weak->Backoff = 0.5f;
		const TSharedRef<FJsonObject> Hello = MakeShared<FJsonObject>();
		Hello->SetStringField(TEXT("type"), TEXT("HELLO"));
		if (!Weak->Token.IsEmpty()) Hello->SetStringField(TEXT("token"), Weak->Token);
		if (!Weak->Username.IsEmpty()) Hello->SetStringField(TEXT("username"), Weak->Username);
		Weak->Send(Hello);
	});
	Socket->OnMessage().AddLambda([Weak](const FString& Text) { if (Weak.IsValid()) Weak->HandleMessage(Text); });
	Socket->OnConnectionError().AddLambda([Weak](const FString& Err) { if (Weak.IsValid()) Weak->HandleClosed(Err); });
	Socket->OnClosed().AddLambda([Weak](int32 Code, const FString& Reason, bool) { if (Weak.IsValid()) Weak->HandleClosed(FString::Printf(TEXT("closed %d %s"), Code, *Reason)); });
	UE_LOG(LogTownChess, Log, TEXT("connecting to %s"), *Url);
	Socket->Connect();
}

void UTCCoreClient::HandleClosed(const FString& Why)
{
	UE_LOG(LogTownChess, Warning, TEXT("connection lost: %s"), *Why);
	SetConnection(ETCConnection::Disconnected);
	if (bWantConnected)
	{
		ReconnectAt = FPlatformTime::Seconds() + Backoff;
		Backoff = FMath::Min(Backoff * 2.f, 8.f);
	}
}

bool UTCCoreClient::TickReconnect(float)
{
	if (bWantConnected && Connection == ETCConnection::Disconnected && ReconnectAt > 0 && FPlatformTime::Seconds() >= ReconnectAt)
	{
		ReconnectAt = 0;
		++ReconnectCount;
		Open();
	}
	return true;
}

void UTCCoreClient::SetConnection(ETCConnection C)
{
	if (Connection == C) return;
	Connection = C;
	OnConnectionChanged.Broadcast(UEnum::GetValueAsString(C));
}

void UTCCoreClient::Send(const TSharedRef<FJsonObject>& Msg)
{
	if (Socket.IsValid() && Socket->IsConnected()) Socket->Send(TCProtocol::ToJson(Msg));
	else UE_LOG(LogTownChess, Warning, TEXT("not connected: dropped %s"), *Msg->GetStringField(TEXT("type")));
}

void UTCCoreClient::SendGame(const TCHAR* Type)
{
	if (!HasGame()) return;
	const TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	M->SetStringField(TEXT("type"), Type);
	M->SetStringField(TEXT("gameId"), State.Id);
	Send(M);
}

void UTCCoreClient::HandleMessage(const FString& Text)
{
	const TSharedPtr<FJsonObject> M = TCProtocol::FromJson(Text);
	if (!M.IsValid()) return;
	const FString Type = M->GetStringField(TEXT("type"));
	if (Type == TEXT("WELCOME"))
	{
		const int32 Version = M->GetIntegerField(TEXT("protocolVersion"));
		if (Version != 2) UE_LOG(LogTownChess, Error, TEXT("core speaks protocol v%d; this client expects v2"), Version);
		Token = M->GetStringField(TEXT("token"));
		FFileHelper::SaveStringToFile(Token, *TokenPath());
		PlayerId = M->GetObjectField(TEXT("player"))->GetStringField(TEXT("id"));
		FString Active;
		ServerActiveGame = M->TryGetStringField(TEXT("activeGameId"), Active) ? Active : FString();
		PendingRejoin = HasGame() && !State.IsFinished() ? State.Id : ServerActiveGame;
		if (!PendingRejoin.IsEmpty())
		{
			// reconnect: ask for the authoritative state and rebuild from it (sent before announcing "welcomed", so
			// nothing reacting to that event can create a competing game first)
			JoinGame(PendingRejoin);
		}
		SetConnection(ETCConnection::Welcomed);
		return;
	}
	if (Type == TEXT("GAME_JOINED"))
	{
		FTCGameState S;
		if (TCProtocol::ParseState(M->GetObjectField(TEXT("state")), S))
		{
			PendingRejoin.Empty();
			MyColor = M->GetStringField(TEXT("color"));
			ApplyState(S, TEXT("joined"));
		}
		return;
	}
	if (Type == TEXT("GAME_STATE_UPDATED"))
	{
		FTCGameState S;
		if (TCProtocol::ParseState(M->GetObjectField(TEXT("state")), S) && S.Id == State.Id) ApplyState(S, M->GetStringField(TEXT("reason")));
		return;
	}
	if (Type == TEXT("MOVE_REJECTED"))
	{
		++RejectedCount;
		LastRejection = M->GetStringField(TEXT("reason"));
		UE_LOG(LogTownChess, Log, TEXT("move rejected by the core: %s"), *LastRejection);
		OnMoveRejected.Broadcast(LastRejection);
		FTCGameState S;
		if (TCProtocol::ParseState(M->GetObjectField(TEXT("state")), S) && S.Id == State.Id) ApplyState(S, TEXT("rejected"));
		return;
	}
	if (Type == TEXT("ERROR"))
	{
		if (!PendingRejoin.IsEmpty() && M->GetStringField(TEXT("code")) == TEXT("not_found"))
		{
			// the game we remembered is gone (e.g. the core restarted after it finished): use the server's view instead
			const FString Gone = PendingRejoin;
			PendingRejoin.Empty();
			if (!ServerActiveGame.IsEmpty() && ServerActiveGame != Gone) { PendingRejoin = ServerActiveGame; JoinGame(ServerActiveGame); }
			else { State = FTCGameState(); MyColor.Empty(); OnState.Broadcast(State, TEXT("left")); }
			return;
		}
		LastError = M->GetStringField(TEXT("message"));
		UE_LOG(LogTownChess, Warning, TEXT("core error %s: %s"), *M->GetStringField(TEXT("code")), *LastError);
		OnError.Broadcast(LastError);
		return;
	}
	// MOVE_ACCEPTED, CLOCK_UPDATE, DRAW_OFFER, REMATCH, OPPONENT_*: the following GAME_STATE_UPDATED carries the facts
}

void UTCCoreClient::ApplyState(const FTCGameState& S, const FString& Reason)
{
	State = S;
	StateReceivedAt = FPlatformTime::Seconds();
	OnState.Broadcast(State, Reason);
}

double UTCCoreClient::GetDisplayClockMs(const FString& Color) const
{
	const double Base = Color == TEXT("w") ? State.WhiteClockMs : State.BlackClockMs;
	if (!State.IsActive() || State.ClockRunning != Color) return Base; // only the clock the core says is running moves
	return FMath::Max(0.0, Base - (FPlatformTime::Seconds() - StateReceivedAt) * 1000.0);
}

void UTCCoreClient::CreateAiGame(const FString& Level, const FString& Color, const FString& TimeControl)
{
	const TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	M->SetStringField(TEXT("type"), TEXT("CREATE_AI_GAME"));
	M->SetStringField(TEXT("level"), Level);
	M->SetStringField(TEXT("color"), Color);
	M->SetStringField(TEXT("timeControl"), TimeControl);
	Send(M);
}

void UTCCoreClient::CreatePrivate(const FString& TimeControl)
{
	const TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	M->SetStringField(TEXT("type"), TEXT("CREATE_PRIVATE"));
	M->SetStringField(TEXT("timeControl"), TimeControl);
	Send(M);
}

void UTCCoreClient::JoinGame(const FString& GameId)
{
	const TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	M->SetStringField(TEXT("type"), TEXT("JOIN_GAME"));
	M->SetStringField(TEXT("gameId"), GameId);
	Send(M);
}

void UTCCoreClient::FindMatch(const FString& TimeControl, bool bRated)
{
	const TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	M->SetStringField(TEXT("type"), TEXT("FIND_MATCH"));
	M->SetStringField(TEXT("timeControl"), TimeControl);
	M->SetBoolField(TEXT("rated"), bRated);
	Send(M);
}

int32 UTCCoreClient::SubmitMove(const FString& From, const FString& To, const FString& Promotion)
{
	if (!HasGame()) return 0;
	const int32 Seq = NextSeq++;
	const TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	M->SetStringField(TEXT("type"), TEXT("MOVE"));
	M->SetStringField(TEXT("gameId"), State.Id);
	M->SetNumberField(TEXT("seq"), Seq);
	M->SetStringField(TEXT("from"), From);
	M->SetStringField(TEXT("to"), To);
	if (!Promotion.IsEmpty()) M->SetStringField(TEXT("promotion"), Promotion);
	M->SetNumberField(TEXT("ply"), State.History.Num());
	Send(M);
	return Seq;
}

void UTCCoreClient::Resign() { SendGame(TEXT("RESIGN")); }
void UTCCoreClient::OfferDraw() { SendGame(TEXT("DRAW_OFFER")); }
void UTCCoreClient::AcceptDraw() { SendGame(TEXT("DRAW_ACCEPT")); }
void UTCCoreClient::DeclineDraw() { SendGame(TEXT("DRAW_DECLINE")); }
void UTCCoreClient::ClaimDraw() { SendGame(TEXT("CLAIM_DRAW")); }
void UTCCoreClient::Rematch() { SendGame(TEXT("REMATCH")); }

void UTCCoreClient::LeaveGame()
{
	SendGame(TEXT("LEAVE_GAME"));
	State = FTCGameState();
	MyColor.Empty();
	OnState.Broadcast(State, TEXT("left"));
}
