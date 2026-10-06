// Second UTC slot for the daily briefing. Vercel keeps ONE schedule per path, so the
// 12:00 UTC (06:00 CST, winter) firing needs its own path. Same handler, same hour gate:
// only the firing where it is 06:00 in Chicago sends.
export { default } from './cron-daily-briefing.js'
