#pragma once

#include "CoreMinimal.h"
#include "Logging/LogMacros.h"

/** Client-side log. */
TOWNCHESS_API DECLARE_LOG_CATEGORY_EXTERN(LogTownChess, Log, All);
/** Output forwarded from the local core process (correlated with client logs in one file). */
TOWNCHESS_API DECLARE_LOG_CATEGORY_EXTERN(LogTownChessCore, Log, All);
