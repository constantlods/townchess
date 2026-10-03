using UnrealBuildTool;

public class TownChess : ModuleRules
{
	public TownChess(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "CinematicCamera", "WebSockets", "Json", "JsonUtilities"
		});
	}
}
