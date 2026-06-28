export interface OperatorSensitivityProfile {
  minSleepLockdown: number;
  minSleepShadow: number;
  minSleepOptimized: number;
  maxDriftShadow: number;
  minFocusShadow: number;
  minEnergyOptimized: number;
  minFocusOptimized: number;
  maxDriftOptimized: number;
  sorenessLockdown: number;
  sorenessRecovery: number;
}

export const operatorSensitivityProfile: OperatorSensitivityProfile = {
  minSleepLockdown: 5.0,
  minSleepShadow: 6.0,
  minSleepOptimized: 7.5,
  maxDriftShadow: 8,
  minFocusShadow: 3,
  minEnergyOptimized: 4,
  minFocusOptimized: 7,
  maxDriftOptimized: 3,
  sorenessLockdown: 9,
  sorenessRecovery: 7,
};
