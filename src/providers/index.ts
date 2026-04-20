import { GmailProvider } from "./gmail.js";
import { OutlookProvider } from "./outlook.js";
import type { EmailProvider, Provider } from "./types.js";

export function providerFor(p: Provider): EmailProvider {
  switch (p) {
    case "gmail":
      return GmailProvider;
    case "outlook":
      return OutlookProvider;
    case "imap":
      throw new Error("imap provider not yet implemented");
  }
}
