/**
 * ServiceTrendRadar — Radar chart visualizing service demand trends.
 *
 * Compares today's activity against last week's patterns across five
 * core service categories so staff can quickly identify which services
 * are trending up or down.
 */

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ServiceDataPoint {
  subject: string;
  A: number;
  B: number;
  fullMark: number;
}

const data: ServiceDataPoint[] = [
  { subject: "Tires", A: 120, B: 110, fullMark: 150 },
  { subject: "Brakes", A: 98, B: 130, fullMark: 150 },
  { subject: "Alignment", A: 86, B: 70, fullMark: 150 },
  { subject: "Oil Change", A: 99, B: 100, fullMark: 150 },
  { subject: "Suspension", A: 85, B: 90, fullMark: 150 },
];

export default function ServiceTrendRadar() {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="subject" />
        <PolarRadiusAxis angle={90} domain={[0, 150]} />
        <Radar
          name="Today"
          dataKey="A"
          stroke="#8884d8"
          fill="#8884d8"
          fillOpacity={0.6}
        />
        <Radar
          name="Last Week"
          dataKey="B"
          stroke="#82ca9d"
          fill="#82ca9d"
          fillOpacity={0.6}
        />
        <Legend />
      </RadarChart>
    </ResponsiveContainer>
  );
}
