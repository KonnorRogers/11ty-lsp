// Configuration interface
export interface NunjucksSettings {
  maxNumberOfProblems: number;
  templatePaths: string[];
  enabledFeatures: {
    completion: boolean;
    diagnostics: boolean;
    hover: boolean;
  };
}
