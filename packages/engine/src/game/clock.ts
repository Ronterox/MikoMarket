/**
 * New York market-clock moments Miko can comment on (opening bell, high noon, power hour...).
 * Times are America/New_York, DST-aware through indicators/nyTime.ts.
 */
import { nyDay, nyOffsetHours } from '../indicators/nyTime.ts';
import type { Mood } from '../types.ts';

const MIN = 60_000;
const DAY = 86_400_000;

export interface ClockMoment {
  id: string;
  /** Minutes after NY midnight when the moment starts. */
  minute: number;
  /** How long after `minute` a first bar still counts (so a 13:40 bar does not say "high noon"). */
  window: number;
  /** NY weekdays it applies to (0 = Sunday). */
  days: readonly number[];
  mood: Mood;
  lines: readonly string[];
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** The moments, in time order. Each line is <= 120 chars and the trading content is accurate. */
export const CLOCK_MOMENTS: readonly ClockMoment[] = [
  {
    id: 'overnight_late', minute: 0, window: 240, days: [1, 2, 3, 4, 5], mood: 'sleepy',
    lines: [
      'Trading past midnight? Night owls 🦉 Overnight futures volume is thin, so moves can be jumpy.',
      'Midnight market club 🌙 Thin overnight liquidity means wider swings. Keep size small, senpai.',
    ],
  },
  {
    id: 'premarket', minute: 240, window: 330, days: WEEKDAYS, mood: 'sleepy',
    lines: [
      'Pre-market early bird 🐦 Volume is thin before 9:30, so spreads are wider and moves can fake out.',
      'Up before the bell? ☕ Pre-market prices can gap around on little volume. The real crowd comes at 9:30.',
      'Good morning, early riser 🌅 Pre-market levels often matter later, so note the highs and lows!',
    ],
  },
  {
    id: 'monday_open', minute: 570, window: 15, days: [1], mood: 'excited',
    lines: [
      'Monday opening bell 🔔 New week, new chart! Weekend news can gap things, so let the first bars settle.',
      'Ohayo, Monday! 🌸 Watch for weekend gaps at the open. Patience beats chasing the first candle.',
    ],
  },
  {
    id: 'opening_bell', minute: 570, window: 15, days: [2, 3, 4, 5], mood: 'excited',
    lines: [
      'Ding ding! 🔔 Opening bell! The first minutes are the most volatile of the day. Seatbelts on.',
      "It's 9:30 in New York 🗽 Volume floods in now. Big moves, big spreads: no need to rush.",
      'The market is OPEN ✨ Opening range forming. Many traders wait for the first 15-30 min to settle.',
    ],
  },
  {
    id: 'first_30', minute: 600, window: 15, days: WEEKDAYS, mood: 'teaching',
    lines: [
      'First 30 minutes done ✅ The opening range is set. Breaks of its high or low are popular setups.',
      '10:00 ET 🕙 The opening chaos usually calms a bit now. Economic data often drops at 10, too!',
    ],
  },
  {
    id: 'late_morning', minute: 690, window: 20, days: WEEKDAYS, mood: 'happy',
    lines: [
      '11:30 ET 🕦 Late morning: Europe is closing, and volume often starts to fade into lunch.',
      'Half past eleven ✨ The morning trend is usually set by now. Is price above or below VWAP?',
    ],
  },
  {
    id: 'high_noon', minute: 720, window: 20, days: WEEKDAYS, mood: 'excited',
    lines: [
      "It's high noon… 🤠 Draw your stops, partner. Midday chop shoots down impatient traders.",
      'High noon in New York 🤠🌵 Sun is up, volume is down. Quick-draw trades get whipsawed now.',
      "12:00! It's high noon 🤠 Cassidy would wait for a clean shot, and so should we.",
    ],
  },
  {
    id: 'lunch', minute: 750, window: 20, days: WEEKDAYS, mood: 'happy',
    lines: [
      'Time for lunch 🍱 Wall Street is eating too, so volume is thin and breakouts fail more often.',
      'Ramen break? 🍜 Lunch hour liquidity is low. Fewer, cleaner trades (or none!) is the move.',
      'Lunchtime 🍙 Thin volume means choppy candles. Even Miko takes a snack break now.',
    ],
  },
  {
    id: 'lunch_over', minute: 780, window: 20, days: WEEKDAYS, mood: 'cheer',
    lines: [
      'Lunch is over! 🍵 Traders drift back to their desks. Watch if volume starts picking up again.',
      '1 PM ET ✨ Break time is over. Afternoon moves often test the morning highs and lows.',
    ],
  },
  {
    id: 'slump', minute: 840, window: 20, days: WEEKDAYS, mood: 'sleepy',
    lines: [
      '2 PM afternoon slump ☕ Coffee time! Fed announcements land at 2:00 on FOMC days, so stay alert.',
      'Sleepy 2 o\'clock ☕ Afternoon drift can lull you in. Stick to your setups, not boredom trades.',
    ],
  },
  {
    id: 'power_hour', minute: 900, window: 20, days: WEEKDAYS, mood: 'excited',
    lines: [
      'POWER HOUR ⚡ The last hour is one of the busiest: funds rebalance and volume ramps up.',
      '3 PM ET ⚡ Power hour! Volatility returns into the close. Respect your stops, nakama.',
      'Final hour, go go go ⚡ Big volume, faster moves. Plus Ultra… but with a stop-loss!',
    ],
  },
  {
    id: 'weekend_loading', minute: 930, window: 15, days: [5], mood: 'cheer',
    lines: [
      'Weekend loading… ██████░░ 75% 🎮 Holding over the weekend means gap risk on Monday!',
      'Friday 3:30 🎉 Almost weekend! Many day traders go flat now: news cannot gap a closed position.',
    ],
  },
  {
    id: 'last_call', minute: 950, window: 10, days: WEEKDAYS, mood: 'worried',
    lines: [
      'Last call! ⏰ 10 minutes to the close. Day traders: decide now, not in the final seconds.',
      '3:50 ET ⏳ Closing imbalances hit around now and can move price fast. Plan your exit.',
    ],
  },
  {
    id: 'closing_bell', minute: 960, window: 5, days: WEEKDAYS, mood: 'proud',
    lines: [
      'Closing bell 🔔 That is the regular session! Otsukaresama, you made it through the day.',
      "Ding! 🔔 4 PM, regular hours are done. Time to review: what was your best decision today?",
    ],
  },
  {
    id: 'after_hours', minute: 965, window: 235, days: WEEKDAYS, mood: 'sleepy',
    lines: [
      'After-hours night owls 🦉 Volume is thin, so earnings news can swing prices hard.',
      'Extended hours 🌙 Spreads widen after 4 PM. Limit orders are your friend now.',
    ],
  },
  {
    id: 'sunday_open', minute: 1080, window: 60, days: [0], mood: 'excited',
    lines: [
      'Sunday 6 PM ET: futures are back! 🌏 Asia wakes up soon. Weekend news shows up as a gap.',
      'The futures week begins 🌙 Sunday evening opens can gap. Let the first bars show the mood.',
    ],
  },
  {
    id: 'overnight', minute: 1200, window: 240, days: [0, 1, 2, 3, 4], mood: 'sleepy',
    lines: [
      'Night owls 🦉 It is 8 PM in New York. Overnight futures are quiet: small size, wide eyes.',
      'Evening session 🌃 Asia is trading now. Overnight ranges are usually smaller than daytime ones.',
    ],
  },
];

export interface NyClock {
  /** NY calendar day number (days since 1970-01-01 in NY local time). */
  day: number;
  /** Minutes after NY midnight. */
  minute: number;
  /** 0 = Sunday ... 6 = Saturday, NY local. */
  dow: number;
}

/** New York wall clock for an epoch-ms instant (DST-aware). */
export function nyClock(t: number): NyClock {
  const local = t + nyOffsetHours(t) * 3_600_000;
  const day = nyDay(t);
  const minute = Math.floor((((local % DAY) + DAY) % DAY) / MIN);
  return { day, minute, dow: (((day + 4) % 7) + 7) % 7 };
}
