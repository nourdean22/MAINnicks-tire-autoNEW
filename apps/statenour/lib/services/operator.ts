import { CommunicationMode, DesignMode, DevicePriority } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";

export type OperatorProfileView = {
  preferredName: string;
  communicationMode: "neutral" | "direct" | "shadow";
  devicePriority: "phone_first" | "desktop_first" | "balanced";
  designMode: "shadow_tactical" | "automotive_executive" | "boardroom_minimal";
  systemObjective: string;
  preferredPressureStyle: string;
  antiPatterns: string[];
  primaryAmbitions: string[];
  uiDensity: string;
  motionLevel: string;
  alertAggressiveness: string;
};

const defaultProfile: OperatorProfileView = {
  preferredName: process.env.AUTH_MOCK_USER_NAME || "Nick",
  communicationMode: "direct",
  devicePriority: "phone_first",
  designMode: "shadow_tactical",
  systemObjective: "Clarity, pressure, and fast action over comfort.",
  preferredPressureStyle: "high-friction when wandering starts",
  antiPatterns: ["opening too many loops", "drifting into novelty", "letting execution become browsing"],
  primaryAmbitions: ["tight execution", "revenue recovery", "one operator surface that actually gets used"],
  uiDensity: "low",
  motionLevel: "low",
  alertAggressiveness: "high"
};

function toView(record: {
  preferredName: string;
  communicationMode: CommunicationMode;
  devicePriority: DevicePriority;
  designMode: DesignMode;
  systemObjective: string | null;
  preferredPressureStyle: string | null;
  antiPatterns: unknown;
  primaryAmbitions: unknown;
  preferences?: {
    uiDensity: string;
    motionLevel: string;
    alertAggressiveness: string;
  } | null;
}): OperatorProfileView {
  return {
    preferredName: record.preferredName,
    communicationMode: record.communicationMode.toLowerCase() as OperatorProfileView["communicationMode"],
    devicePriority: record.devicePriority.toLowerCase() as OperatorProfileView["devicePriority"],
    designMode: record.designMode.toLowerCase() as OperatorProfileView["designMode"],
    systemObjective: record.systemObjective || defaultProfile.systemObjective,
    preferredPressureStyle: record.preferredPressureStyle || defaultProfile.preferredPressureStyle,
    antiPatterns: Array.isArray(record.antiPatterns) ? (record.antiPatterns as string[]) : defaultProfile.antiPatterns,
    primaryAmbitions: Array.isArray(record.primaryAmbitions) ? (record.primaryAmbitions as string[]) : defaultProfile.primaryAmbitions,
    uiDensity: record.preferences?.uiDensity || defaultProfile.uiDensity,
    motionLevel: record.preferences?.motionLevel || defaultProfile.motionLevel,
    alertAggressiveness: record.preferences?.alertAggressiveness || defaultProfile.alertAggressiveness
  };
}

export async function getOperatorProfile(operator: { email: string; name: string }) {
  if (isDemoMode) {
    return {
      ...defaultProfile,
      preferredName: operator.name || defaultProfile.preferredName
    };
  }

  try {
    const profile = await prisma.operatorProfile.upsert({
      where: { operatorEmail: operator.email },
      update: {},
      create: {
        operatorEmail: operator.email,
        preferredName: operator.name || defaultProfile.preferredName,
        communicationMode: CommunicationMode.DIRECT,
        devicePriority: DevicePriority.PHONE_FIRST,
        designMode: DesignMode.SHADOW_TACTICAL,
        systemObjective: defaultProfile.systemObjective,
        preferredPressureStyle: defaultProfile.preferredPressureStyle,
        antiPatterns: defaultProfile.antiPatterns,
        primaryAmbitions: defaultProfile.primaryAmbitions
      },
      include: {
        preferences: true
      }
    });

    const preferences =
      profile.preferences ||
      (await prisma.operatorPreference.upsert({
        where: { operatorProfileId: profile.id },
        update: {},
        create: {
          operatorProfileId: profile.id,
          uiDensity: defaultProfile.uiDensity,
          motionLevel: defaultProfile.motionLevel,
          alertAggressiveness: defaultProfile.alertAggressiveness,
          voiceToneBoundaries: {
            no_abuse: true,
            concise: true,
            direct: true
          }
        }
      }));

    return toView({
      ...profile,
      preferences
    });
  } catch {
    return {
      ...defaultProfile,
      preferredName: operator.name || defaultProfile.preferredName
    };
  }
}

function toCommunicationMode(value: OperatorProfileView["communicationMode"]) {
  switch (value) {
    case "neutral":
      return CommunicationMode.NEUTRAL;
    case "shadow":
      return CommunicationMode.SHADOW;
    default:
      return CommunicationMode.DIRECT;
  }
}

function toDevicePriority(value: OperatorProfileView["devicePriority"]) {
  switch (value) {
    case "desktop_first":
      return DevicePriority.DESKTOP_FIRST;
    case "balanced":
      return DevicePriority.BALANCED;
    default:
      return DevicePriority.PHONE_FIRST;
  }
}

function toDesignMode(value: OperatorProfileView["designMode"]) {
  switch (value) {
    case "automotive_executive":
      return DesignMode.AUTOMOTIVE_EXECUTIVE;
    case "boardroom_minimal":
      return DesignMode.BOARDROOM_MINIMAL;
    default:
      return DesignMode.SHADOW_TACTICAL;
  }
}

export async function updateOperatorProfile(
  operator: { email: string; name: string },
  input: {
    preferredName: string;
    communicationMode: OperatorProfileView["communicationMode"];
    devicePriority: OperatorProfileView["devicePriority"];
    designMode: OperatorProfileView["designMode"];
    systemObjective?: string | null;
    preferredPressureStyle?: string | null;
    antiPatterns: string[];
    primaryAmbitions: string[];
  }
) {
  if (isDemoMode) {
    return {
      ...defaultProfile,
      ...input
    };
  }

  const profile = await prisma.operatorProfile.upsert({
    where: { operatorEmail: operator.email },
    update: {
      preferredName: input.preferredName,
      communicationMode: toCommunicationMode(input.communicationMode),
      devicePriority: toDevicePriority(input.devicePriority),
      designMode: toDesignMode(input.designMode),
      systemObjective: input.systemObjective || defaultProfile.systemObjective,
      preferredPressureStyle: input.preferredPressureStyle || defaultProfile.preferredPressureStyle,
      antiPatterns: input.antiPatterns,
      primaryAmbitions: input.primaryAmbitions
    },
    create: {
      operatorEmail: operator.email,
      preferredName: input.preferredName,
      communicationMode: toCommunicationMode(input.communicationMode),
      devicePriority: toDevicePriority(input.devicePriority),
      designMode: toDesignMode(input.designMode),
      systemObjective: input.systemObjective || defaultProfile.systemObjective,
      preferredPressureStyle: input.preferredPressureStyle || defaultProfile.preferredPressureStyle,
      antiPatterns: input.antiPatterns,
      primaryAmbitions: input.primaryAmbitions
    },
    include: {
      preferences: true
    }
  });

  return toView(profile);
}

export async function updateOperatorPreferences(
  operator: { email: string; name: string },
  input: {
    uiDensity: string;
    motionLevel: string;
    alertAggressiveness: string;
    voiceToneBoundaries?: Record<string, string | boolean | number>;
  }
) {
  if (isDemoMode) {
    return {
      ...defaultProfile,
      uiDensity: input.uiDensity,
      motionLevel: input.motionLevel,
      alertAggressiveness: input.alertAggressiveness
    };
  }

  const profile = await prisma.operatorProfile.upsert({
    where: { operatorEmail: operator.email },
    update: {},
    create: {
      operatorEmail: operator.email,
      preferredName: operator.name || defaultProfile.preferredName,
      communicationMode: CommunicationMode.DIRECT,
      devicePriority: DevicePriority.PHONE_FIRST,
      designMode: DesignMode.SHADOW_TACTICAL,
      systemObjective: defaultProfile.systemObjective,
      preferredPressureStyle: defaultProfile.preferredPressureStyle,
      antiPatterns: defaultProfile.antiPatterns,
      primaryAmbitions: defaultProfile.primaryAmbitions
    }
  });

  const preferences = await prisma.operatorPreference.upsert({
    where: { operatorProfileId: profile.id },
    update: {
      uiDensity: input.uiDensity,
      motionLevel: input.motionLevel,
      alertAggressiveness: input.alertAggressiveness,
      voiceToneBoundaries: input.voiceToneBoundaries || {
        no_abuse: true,
        concise: true,
        direct: true
      }
    },
    create: {
      operatorProfileId: profile.id,
      uiDensity: input.uiDensity,
      motionLevel: input.motionLevel,
      alertAggressiveness: input.alertAggressiveness,
      voiceToneBoundaries: input.voiceToneBoundaries || {
        no_abuse: true,
        concise: true,
        direct: true
      }
    }
  });

  return toView({
    ...profile,
    preferences
  });
}
