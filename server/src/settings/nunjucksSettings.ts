// Configuration interface
export interface NunjucksSettings {
  maxNumberOfProblems: number;
  enabledFeatures: {
    completion: boolean;
    diagnostics: boolean;
    hover: boolean;
  };
}
