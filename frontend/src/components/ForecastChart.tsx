import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Forecast } from '../api/types';
import { Empty, time } from './ui';

export function ForecastChart({ forecast, hospitalId = '' }: { forecast: Forecast; hospitalId?: string }) {
  const data = forecast.intervals.map(bin => {
    const values = hospitalId ? bin.hospitals.find(h => h.hospital_id === hospitalId) : bin;
    return { label: time(bin.start_at), demand: values?.demand_minutes ?? 0, capacity: values?.capacity_minutes ?? 0, unmet: values?.unmet_minutes ?? 0 };
  });
  if (!data.length) return <Empty title="No forecast yet">Import a synthetic dataset to calculate coverage.</Empty>;
  return <div className="forecast-chart" role="img" aria-label="Six interval forecast comparing demand and allocated qualified capacity, in physician minutes."><ResponsiveContainer width="100%" height={250}><AreaChart data={data} margin={{ top: 14, right: 16, bottom: 4, left: 0 }}><defs><linearGradient id="capacity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d8274" stopOpacity={.14}/><stop offset="100%" stopColor="#0d8274" stopOpacity={.01}/></linearGradient></defs><CartesianGrid stroke="#e9eeed" vertical={false}/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#788b88', fontSize: 11 }} dy={10}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#788b88', fontSize: 11 }} width={44}/><Tooltip contentStyle={{ border: '1px solid #dbe6e2', borderRadius: '10px', fontSize: 12 }} formatter={(value, name) => [`${value} min`, name === 'capacity' ? 'Allocated capacity' : 'Consultation demand']}/><Area type="stepAfter" dataKey="capacity" stroke="#0d8274" strokeWidth={2.5} fill="url(#capacity-fill)" isAnimationActive={false}/><Area type="stepAfter" dataKey="demand" stroke="#d79b41" strokeWidth={2} strokeDasharray="5 5" fill="transparent" isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>;
}
export function ChartLegend() { return <div className="chart-legend"><span><i className="legend-capacity"/>Qualified capacity</span><span><i className="legend-demand"/>Consultation demand</span><small>Physician-minutes / 15 min</small></div>; }
