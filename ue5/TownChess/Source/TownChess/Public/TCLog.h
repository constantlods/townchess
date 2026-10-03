#pragma once

#include "CoreMinimal.h"

/** Client-side log. */
TOWNCHESS_API DECLARE_LOG_EXTERN_WITH_VERBOSITY(LogTownChess, Log, All);
/** Output forwarded from the local core process (correlated with client logs in one file). */
TOWNCHESS_API DECLARE_LOG_EXTERN_WITH_VERBOSITY(LogTownChessCore, Log, All);
