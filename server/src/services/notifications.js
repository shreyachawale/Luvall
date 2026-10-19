/**
 * Notification boundary.
 *
 * The first release shows reminders and announcements inside the student/coach portals. Outbound channels
 * (WhatsApp, SMS, email) are external integrations: implement a notifier with `send(message)` for a provider
 * and swap it in `getNotifier()` without touching the reminder logic.
 *
 * A message is { to_user_id, to_mobile, to_email, subject, body }.
 */
import { config } from "../config.js";
import { Batch, MakeupCredit, Session, User } from "../models/index.js";
import { localInstant, now as clockNow } from "../utils/clock.js";
import { fmtDay, fmtTime } from "../utils/dates.js";
import { log } from "../utils/logger.js";
import * as batchSvc from "./batches.js";
import { businessRules } from "./rules.js";

/** Default: writes the message to the application log (no external delivery). */
export class LogNotifier {
  send(message) {
    log("info", "notification", { path: `user:${message.to_user_id}` });
    log("info", `${message.subject} -> ${message.to_mobile || message.to_email}: ${message.body}`);
  }
}

export function getNotifier() {
  return new LogNotifier();
}

/** Academy-local calendar date "YYYY-MM-DD" of an instant. */
function localDate(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Session reminders for every student expected at a session starting within the reminder window. */
export async function upcomingReminders(academy, at = null) {
  const rules = businessRules(academy);
  const current = at ?? clockNow();
  const horizon = new Date(current.getTime() + rules.reminder_hours_before * 3600000);
  const sessions = await Session.find({
    academy_id: academy._id,
    status: "scheduled",
    session_date: { $gte: localDate(current), $lte: localDate(horizon) },
  }).sort({ session_date: 1, start_time: 1 });
  const messages = [];
  for (const s of sessions) {
    const start = localInstant(s.session_date, s.start_time);
    if (!(current <= start && start <= horizon)) continue;
    const studentIds = (await batchSvc.regularEnrollmentsOn(s.batch_id, s.session_date)).map((e) => e.student_id);
    const booked = await MakeupCredit.find({ booked_session_id: s._id, status: "booked" }).select("student_id").sort({ _id: 1 });
    studentIds.push(...booked.map((c) => c.student_id));
    if (!studentIds.length) continue;
    const batch = await Batch.findById(s.batch_id).select("name");
    const batchName = batch ? batch.name : null;
    for (const user of await User.find({ _id: { $in: studentIds } }).sort({ _id: 1 })) {
      const firstName = String(user.name).trim().split(/\s+/)[0];
      messages.push({
        to_user_id: String(user._id),
        to_mobile: user.mobile,
        to_email: user.email,
        subject: `Reminder: ${batchName}`,
        body: `Hi ${firstName}, your ${batchName} session is on ${fmtDay(s.session_date)} at ${fmtTime(s.start_time)}.`,
      });
    }
  }
  return messages;
}

/** Send every due reminder; returns how many were sent. */
export async function sendReminders(academy, notifier = null) {
  const sender = notifier ?? getNotifier();
  const messages = await upcomingReminders(academy);
  for (const m of messages) await sender.send(m);
  return messages.length;
}
