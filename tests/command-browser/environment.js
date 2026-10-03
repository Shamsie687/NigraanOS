const times={valid_at:new Date().toISOString(),fetched_at:new Date().toISOString()};
const weather={...times,status:'current',temperature_c:25.6,apparent_temperature_c:30.5,humidity_percent:93,wind_speed_kmh:9.9,weather_code:0,precipitation:{amount_mm:0,interval_seconds:900},rain:{amount_mm:0},source:{attribution:'Open-Meteo · weather model data'}};
const air={...times,status:'stale',aqi:81,aqi_category:'Moderate',pm2_5_ug_m3:15.1,pm10_ug_m3:24,no2_ug_m3:5,o3_ug_m3:8,source:{attribution:'Open-Meteo · Copernicus CAMS'}};
export default function useContext(){return {data:{weather,air_quality:air,rainfall_context:{previous_24h:{coverage:'partial',hours_available:23,hours_expected:24}}},loading:false,refresh:()=>{}};}
