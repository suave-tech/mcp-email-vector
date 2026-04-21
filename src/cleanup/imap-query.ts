import type { SearchObject } from "imapflow";
import type { CleanupRules } from "./rules.js";

// Translate the shared CleanupRules schema into IMAP SEARCH criteria.
// IMAP SEARCH can't span folders, so the returned plan is re-applied per
// folder by the runner.
//
// Veto lists (rules.keep) are applied client-side after the UID set comes
// back: IMAP's NOT clause works on individual terms but doesn't compose
// cleanly with ORs, so it's simpler + safer to filter after fetching the
// preview metadata. For huge result sets the extra round trip is irrelevant
// vs. the batchModify scan Gmail already does.

export interface ImapSearchPlan {
  search: SearchObject;
  vetoSenders: string[];
  vetoSubjectMatches: string[];
  vetoLabels: string[]; // folder names — runner skips these folders entirely
}

export function rulesToImapPlan(rules: CleanupRules): ImapSearchPlan {
  const search: SearchObject = {};

  // Positive include filters joined via OR blocks.
  const orBlocks: SearchObject[] = [];
  if (rules.senders.length) {
    orBlocks.push({ or: rules.senders.map((s) => ({ from: s })) });
  }
  if (rules.subjectMatches.length) {
    orBlocks.push({ or: rules.subjectMatches.map((s) => ({ subject: s })) });
  }
  if (orBlocks.length === 1) {
    Object.assign(search, orBlocks[0]);
  } else if (orBlocks.length > 1) {
    // Multiple positive axes combined with AND (implicit).
    Object.assign(search, ...orBlocks);
  }

  if (rules.olderThanDays) {
    search.before = new Date(Date.now() - rules.olderThanDays * 86_400_000);
  }

  if (rules.hasUnsubscribe) {
    // Yahoo honors `HEADER List-Unsubscribe ""` as a presence test.
    search.header = { "list-unsubscribe": "" };
  }

  // System safety rails: never touch flagged/starred messages.
  search.flagged = false;

  return {
    search,
    vetoSenders: rules.keep.senders,
    vetoSubjectMatches: rules.keep.subjectMatches,
    vetoLabels: rules.keep.labels,
  };
}

export function passesVetoes(
  plan: ImapSearchPlan,
  candidate: { from: string; subject: string; folder: string },
): boolean {
  const fromLc = candidate.from.toLowerCase();
  if (plan.vetoSenders.some((s) => fromLc.includes(s.toLowerCase()))) return false;
  const subjectLc = candidate.subject.toLowerCase();
  if (plan.vetoSubjectMatches.some((s) => subjectLc.includes(s.toLowerCase()))) return false;
  if (plan.vetoLabels.includes(candidate.folder)) return false;
  return true;
}
