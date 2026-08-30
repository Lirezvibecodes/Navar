import { useRef, useState } from "react";
import { ChooseName } from "./ChooseName";
import { ActionButton } from "./ui";
import {
  ArrowRightIcon,
  CrateIcon,
  HeadphonesIcon,
  SocialIcon,
  type IconProps,
} from "../icons";
import { scrollBehavior } from "../lib/motion";
import { haptic } from "../telegram";
import type { Me } from "../types";

/**
 * The hello, and the first thing anybody sees.
 *
 * Three cards, then the name screen. It is a hello rather than an onboarding
 * funnel: nobody arrives here from an app store having been sold something —
 * they got here by forwarding a song to a bot inside a chat, so the job is to
 * say what this is, not to convince them of it. Which is why there is no
 * "skip": there are three sentences and then the screen they were going to see
 * anyway.
 *
 * The cards are a scroll container with snap points rather than a gesture
 * handler. The WebView's own scrolling is smoother than anything reimplemented
 * on touch events, it carries the platform's momentum and rubber-banding for
 * free, and it means the dots below only ever have to read a scroll position
 * rather than own one.
 */

const SEEN_KEY = "navaar.welcomed";

/**
 * Keyed by the person, not by the install. Two accounts sharing a phone each
 * get their own hello, and the person who has already had theirs does not get
 * it again for changing their name later.
 */
function seenKey(userId: string | number): string {
  return `${SEEN_KEY}.${userId}`;
}

function hasBeenWelcomed(userId: string | number): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) != null;
  } catch {
    // A WebView with storage denied is not a reason to fail to open. It is
    // also not a reason to nag: falling through to "already seen" would skip a
    // real first run, so the hello is shown and simply not remembered.
    return false;
  }
}

function rememberWelcomed(userId: string | number): void {
  try {
    localStorage.setItem(seenKey(userId), new Date().toISOString());
  } catch {
    // See above. Nothing here is worth interrupting the first run over.
  }
}

interface Card {
  icon: (props: IconProps) => React.ReactNode;
  title: string;
  body: string;
}

const CARDS: Card[] = [
  {
    icon: HeadphonesIcon,
    title: "Hey — welcome to Navaar.",
    body: "Your music, kept in Telegram, played properly.",
  },
  {
    icon: CrateIcon,
    title: "Send a song to the bot.",
    body: "It lands in your Crate, artwork and all.",
  },
  {
    icon: SocialIcon,
    title: "Music's better shared.",
    body: "Friends, what they're playing, playlists you can pass around.",
  },
];

/**
 * The whole of the first run: the hello, then the name.
 *
 * Sequencing the two here rather than in App keeps the routing there down to
 * the one thing it is actually deciding — whether this person has a name yet —
 * and leaves ChooseName exactly as it was, with no idea it is now second.
 */
export function FirstRun({
  me,
  onChosen,
}: {
  me: Me;
  onChosen: (handle: string) => void;
}) {
  // Read once, when the screen mounts. Reading it during every render would
  // mean the card stack disappearing underneath the person the moment the
  // write lands, instead of when they press the button.
  const [greeted, setGreeted] = useState(() => hasBeenWelcomed(me.id));

  if (!greeted) {
    return (
      <Welcome
        onDone={() => {
          rememberWelcomed(me.id);
          setGreeted(true);
        }}
      />
    );
  }

  return <ChooseName suggestion={me.username ?? ""} onChosen={onChosen} />;
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const [card, setCard] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    haptic.press();
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: scrollBehavior(),
    });
  };

  return (
    <div
      style={{
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        zIndex: 1,
        // The band runs to the very top of the screen and carries the inset
        // itself, so this container starts at zero. ChooseName still draws the
        // old box; the two no longer match, which is the price of the hello
        // having a face and is worth it exactly once.
        padding: "0 0 calc(var(--tg-safe-bottom) + 24px)",
      }}
    >
      {/* The wordmark, once, in the app's own colours. Dark ink on it: this is
          the one bright surface in Navaar, and white on lime is unreadable. */}
      <div
        className="nav-hero-band"
        style={{
          flex: "none",
          display: "grid",
          placeItems: "center",
          paddingTop: "calc(var(--nav-top-inset) + 34px)",
          paddingBottom: 30,
        }}
      >
        <span
          className="nav-display"
          style={{ fontSize: 38, lineHeight: 1, color: "#0A0A0A" }}
        >
          Navaar
        </span>
      </div>

      <div
        className="nav-rise"
        style={{ margin: "auto 0", display: "flex", flexDirection: "column", gap: 22 }}
      >
        <div
          ref={trackRef}
          className="nav-shelf nav-pager"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.clientWidth === 0) return;
            // Rounded, not floored: a card is current from the moment it is
            // more than half of what you are looking at, which is when the
            // snap has already decided where it is going.
            const next = Math.round(el.scrollLeft / el.clientWidth);
            if (next !== card) setCard(next);
          }}
        >
          {CARDS.map((entry) => (
            <CardFace key={entry.title} card={entry} />
          ))}
        </div>

        <div style={{ padding: "0 26px", display: "flex", flexDirection: "column", gap: 22 }}>
          <Dots count={CARDS.length} active={card} onSelect={goTo} />

          {/* Present from the first card. Making it wait for the third would
              hold someone who has read enough hostage to a swipe they have no
              reason to know is coming. */}
          <div style={{ display: "flex" }}>
            <ActionButton
              height={46}
              grow={false}
              variant="disc"
              icon={ArrowRightIcon}
              onClick={onDone}
            >
              Let&rsquo;s pick your name
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One card. Its own width is the page, and the horizontal padding lives in here
 * rather than on the track: padding on a snapping scroll container is measured
 * differently across WebViews, and a card that is one viewport wide is the one
 * thing the snap points depend on being exact.
 */
function CardFace({ card }: { card: Card }) {
  const Icon = card.icon;
  return (
    <div
      style={{
        width: "100%",
        padding: "0 26px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        className="nav-glass"
        style={{
          width: 62,
          height: 62,
          borderRadius: 20,
          display: "grid",
          placeItems: "center",
          color: "var(--color-nav-action)",
        }}
      >
        <Icon size={28} />
      </div>

      <h1
        className="nav-display"
        style={{ margin: "2px 0 0", fontSize: 21, lineHeight: 1.15 }}
      >
        {card.title}
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(255,255,255,.6)",
          // Reserved, so a two-line card and a one-line card put the dots and
          // the button in the same place and neither jumps as you swipe.
          minHeight: 39,
        }}
      >
        {card.body}
      </p>
    </div>
  );
}

/**
 * Where you are in the three. Tappable as well as swipeable — the dots are the
 * only thing on the screen that says there is more than one card, so they may
 * as well also be the way to get there.
 */
function Dots({
  count,
  active,
  onSelect,
}: {
  count: number;
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          className="nav-press"
          aria-label={`Card ${i + 1} of ${count}`}
          aria-current={i === active}
          onClick={() => onSelect(i)}
          style={{
            width: i === active ? 18 : 6,
            height: 6,
            padding: 0,
            border: 0,
            borderRadius: 3,
            background:
              i === active ? "var(--color-nav-action)" : "var(--color-nav-ghost)",
            // A width transition, deliberately. It relayouts three 6px boxes
            // once per swipe, and every way of faking it with a transform
            // either changes the gaps or needs a second element sliding behind
            // the dots — more machinery than the thing it animates.
            transition: "width var(--dur-state) var(--ease)",
          }}
        />
      ))}
    </div>
  );
}
