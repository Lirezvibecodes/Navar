import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getLiveState } from "../api";
import { Avatar } from "./Avatar";
import { Cover } from "./PixelArt";
import { Sheet, SheetItem, TextField } from "./ui";
import { AddToPlaylistSheet, useKeepTrack } from "./TrackMenu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
  DotsIcon,
  LibraryIcon,
  PlaylistIcon,
  PlusIcon,
  SocialIcon,
  TrashIcon,
  WaveIcon,
} from "../icons";
import type { IconProps } from "../icons";
import { useJam } from "../context/JamContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import { useLibrary } from "../context/LibraryContext";
import { formatDuration, personName, trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";
import type { JamQueueItem, JamTrack, LiveState, Person, Track } from "../types";

/**
 * Jam Mode's own pieces: the live card on a friend's profile, and the three
 * sheets a join goes through — asking, waiting, and (for the host) answering.
 *
 * The jam violet only ever appears against the theme accent, in a gradient or
 * beside it, so a jam reads as the two of you rather than as a new theme.
 */

const LIVE_POLL_MS = 25_000;
/** A request the server has not answered by its expiry is treated as gone this long after. */
const REQUEST_GRACE_MS = 5_000;

const JAM_GRADIENT = "linear-gradient(90deg, var(--color-nav-jam), var(--color-nav-action))";

/** How far the live card on a profile reaches up into the banner above it. */
export const LIVE_CARD_OVERLAP = 45;

/** Height of both buttons at the foot of a jam sheet: the answer and the way out match. */
const SHEET_BUTTON_H = 54;

// --- Time -------------------------------------------------------------------------

/** Re-renders once a second while `active`, for a clock that runs on its own. */
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Where somebody else's track is now, from where it was when the server last heard. */
export function positionNow(
  position: number,
  atMs: number,
  playing: boolean,
  duration: number | null,
  now: number
): number {
  const at = playing ? position + Math.max(0, now - atMs) / 1000 : position;
  return duration != null ? Math.min(at, duration) : at;
}

// --- Bits ---------------------------------------------------------------------------

export function JamCover({ track, size, radius, style }: { track: JamTrack; size: number; radius: number; style?: React.CSSProperties }) {
  return (
    <Cover
      trackId={track.cover_track_id ?? track.id}
      hasCover={track.cover_track_id != null}
      size={size}
      radius={radius}
      style={style}
    />
  );
}

function ProgressLine({ position, duration }: { position: number; duration: number | null }) {
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 2,
          background: "var(--color-nav-action)",
          transition: "width 1s linear",
        }}
      />
    </div>
  );
}

/** The accent-to-violet button that commits to a jam. Dark label: it has to read on both ends. */
export function JamButton({
  children,
  onClick,
  icon: Icon = SocialIcon,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: (props: IconProps) => ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="nav-press"
      disabled={disabled}
      onClick={() => {
        haptic.press();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        height: SHEET_BUTTON_H,
        borderRadius: SHEET_BUTTON_H / 2,
        background: JAM_GRADIENT,
        color: "#0A0A0A",
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        opacity: disabled ? 0.45 : 1,
        boxShadow:
          "0 0 24px rgba(var(--color-nav-jam-rgb),.42), 0 8px 26px rgba(var(--color-nav-action-rgb),.2)",
      }}
    >
      <Icon size={18} />
      {children}
    </button>
  );
}

/** The dark pill under a jam sheet's gradient button: same size, no colour. */
function SheetSecondary({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="nav-press"
      disabled={disabled}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        width: "100%",
        height: SHEET_BUTTON_H,
        borderRadius: SHEET_BUTTON_H / 2,
        background: "rgba(255,255,255,.055)",
        border: "1px solid rgba(255,255,255,.07)",
        color: "rgba(255,255,255,.82)",
        fontSize: 16,
        fontWeight: 500,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** The track card inside the join and approval sheets. */
function SheetTrackCard({ track, position, cover = 72 }: { track: JamTrack; position: number; cover?: number }) {
  return (
    <div
      className="nav-glass"
      style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, borderRadius: 16, textAlign: "left" }}
    >
      <JamCover track={track} size={cover} radius={8} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nav-clip" style={{ fontSize: 15, fontWeight: 600 }}>
          {track.title ?? "Untitled"}
        </div>
        <div className="nav-clip" style={{ fontSize: 13, color: "var(--color-nav-muted)", marginTop: 2 }}>
          {track.artist ?? "Unknown artist"}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-nav-faint)", margin: "4px 0 8px" }}>
          <span className="nav-numeral">
            {formatDuration(position)} / {formatDuration(track.duration_seconds)}
          </span>
        </div>
        <ProgressLine position={position} duration={track.duration_seconds} />
      </div>
    </div>
  );
}

/** The centred block every jam sheet opens with. */
function SheetHead({ badge, title, children }: { badge: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "4px 14px 0" }}>
      {badge}
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 16, letterSpacing: "-0.015em" }}>{title}</div>
      {children}
    </div>
  );
}

function Copy({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-nav-muted)", margin: "12px 0 0", maxWidth: 300 }}>
      {children}
    </p>
  );
}

function WaveBadge() {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        width: 64,
        height: 64,
        borderRadius: "50%",
        background: "rgba(var(--color-nav-jam-rgb),.14)",
        boxShadow: "0 0 26px rgba(var(--color-nav-jam-rgb),.22)",
        color: "var(--color-nav-jam)",
      }}
    >
      <WaveIcon size={30} />
    </div>
  );
}

/** Concentric rings with one arc running round them: asked, not yet answered. */
function WaitingBadge() {
  const ring = (inset: number, alpha: number): React.CSSProperties => ({
    position: "absolute",
    inset,
    borderRadius: "50%",
    border: `1px solid rgba(var(--color-nav-jam-rgb),${alpha})`,
  });
  return (
    <div style={{ position: "relative", width: 176, height: 176 }}>
      <div style={ring(0, 0.1)} />
      <div style={ring(20, 0.18)} />
      <div
        className="nav-spin"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: "2px solid transparent",
          borderTopColor: "var(--color-nav-jam)",
          animationDuration: "1.6s",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 44,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          border: "2px solid var(--color-nav-jam)",
          background: "rgba(var(--color-nav-jam-rgb),.16)",
          boxShadow: "0 0 30px rgba(var(--color-nav-jam-rgb),.35)",
          color: "#fff",
        }}
      >
        <SocialIcon size={36} />
      </div>
    </div>
  );
}

function SheetActions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "24px 14px 0" }}>{children}</div>;
}

// --- A friend's live state ------------------------------------------------------------

export interface LiveView {
  state: LiveState | null;
  /** Server clock minus local clock, in ms. */
  skew: number;
  refresh: () => void;
}

/**
 * What a friend is playing, polled while their profile is on screen: every
 * 25s while visible, on coming back to the front, and whenever the viewer's
 * own jam changes (a join, a leave).
 */
export function useLiveState(userId: number, enabled: boolean): LiveView {
  const { jam, outgoing } = useJam();
  const [state, setState] = useState<LiveState | null>(null);
  const [skew, setSkew] = useState(0);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!enabled) return;
    const ticket = ++seq.current;
    getLiveState(userId)
      .then((next) => {
        if (ticket !== seq.current) return;
        setSkew(Date.parse(next.server_now) - Date.now());
        setState(next);
      })
      .catch(() => {
        // A friend we can no longer see, or a dropped request: show nothing
        // rather than an old state.
        if (ticket === seq.current) setState(null);
      });
  }, [userId, enabled]);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, LIVE_POLL_MS);
    const onFront = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onFront);
    window.addEventListener("focus", onFront);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFront);
      window.removeEventListener("focus", onFront);
    };
  }, [enabled, refresh]);

  // The viewer's own jam moving is the thing most likely to have changed
  // what this card should say.
  const jamId = jam?.id ?? null;
  const outgoingStatus = outgoing?.status ?? null;
  useEffect(() => {
    refresh();
  }, [jamId, outgoingStatus, refresh]);

  return { state, skew, refresh };
}

// --- The live card on a friend's profile ------------------------------------------

export function LiveCard({
  host,
  view,
  onOpenPlayer,
}: {
  host: Person;
  view: LiveView;
  onOpenPlayer: () => void;
}) {
  const { jam, outgoing } = useJam();
  const [joinOpen, setJoinOpen] = useState(false);
  const live = view.state?.live ?? null;
  const theirJam = view.state?.jam ?? null;
  const now = useTicker(live?.is_playing ?? false);

  // The sheet keeps what it was opened on, so it can animate out after the
  // card has already collapsed.
  const lastLive = useRef(live);
  if (live) lastLive.current = live;

  if (!live) {
    return <JoinSheet open={joinOpen && lastLive.current != null} onClose={() => setJoinOpen(false)} host={host} view={view} />;
  }

  const duration = live.track.duration_seconds;
  const position = positionNow(
    live.position_seconds,
    Date.parse(live.position_at) - view.skew,
    live.is_playing,
    duration,
    now
  );

  const member = theirJam?.viewer_is_member ?? false;
  const asked = outgoing?.status === "pending" && outgoing.host.telegram_user_id === host.telegram_user_id;
  const full = theirJam != null && theirJam.listener_count >= 4;
  // Only a host takes requests; somebody who is a guest in another jam can't.
  const joinable = !member && !jam && (theirJam == null || (theirJam.role === "host" && !full));

  const label = member
    ? "In jam"
    : theirJam
      ? `Jamming · ${theirJam.listener_count} listeners`
      : "Live";

  return (
    <>
      <div
        className="nav-rise"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "relative",
          zIndex: 1,
          padding: 11,
          marginTop: -LIVE_CARD_OVERLAP,
          marginBottom: 20,
          borderRadius: 14,
          border: "1px solid transparent",
          background: `linear-gradient(#0c0c0f, #0c0c0f) padding-box, linear-gradient(90deg, rgba(var(--color-nav-action-rgb),.85), rgba(var(--color-nav-jam-rgb),.85)) border-box`,
          boxShadow: "0 0 26px rgba(var(--color-nav-jam-rgb),.16)",
        }}
      >
        <JamCover
          track={live.track}
          size={66}
          radius={8}
          style={{ boxShadow: "0 0 0 1px rgba(var(--color-nav-action-rgb),.7)" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="nav-clip"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-nav-muted)" }}
          >
            <span
              style={{
                flex: "none",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-nav-action)",
              }}
            >
              {label}
            </span>
            <span className="nav-clip">{live.track.artist ?? "Unknown artist"}</span>
          </div>
          <div className="nav-clip" style={{ fontSize: 14.5, fontWeight: 600, marginTop: 2 }}>
            {live.track.title ?? "Untitled"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 7px" }}>
            <span className="nav-numeral" style={{ fontSize: 11, color: "var(--color-nav-faint)" }}>
              {formatDuration(position)} / {formatDuration(duration)}
            </span>
            {live.is_playing ? (
              <WaveIcon size={14} className="nav-pulse" style={{ color: "var(--color-nav-action)", marginLeft: "auto" }} />
            ) : null}
          </div>
          <ProgressLine position={position} duration={duration} />
        </div>

        {member ? (
          <JamPill onClick={onOpenPlayer}>In Jam</JamPill>
        ) : asked ? (
          <JamPill disabled onClick={() => undefined}>Asked</JamPill>
        ) : joinable ? (
          <JamPill onClick={() => setJoinOpen(true)}>Join Them</JamPill>
        ) : full ? (
          <JamPill disabled onClick={() => undefined}>Full</JamPill>
        ) : null}
      </div>

      <JoinSheet open={joinOpen} onClose={() => setJoinOpen(false)} host={host} view={view} />
    </>
  );
}

function JamPill({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="nav-press"
      disabled={disabled}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 36,
        padding: "0 13px",
        borderRadius: 18,
        border: "1.5px solid transparent",
        background: `linear-gradient(rgba(28,20,40,1), rgba(28,20,40,1)) padding-box, linear-gradient(90deg, var(--color-nav-action), var(--color-nav-jam)) border-box`,
        color: "var(--color-nav-jam-soft)",
        fontSize: 13,
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
        boxShadow: disabled ? undefined : "0 0 18px rgba(var(--color-nav-jam-rgb),.22)",
      }}
    >
      <SocialIcon size={15} />
      {children}
    </button>
  );
}

// --- Asking --------------------------------------------------------------------------------

function JoinSheet({
  open,
  onClose,
  host,
  view,
}: {
  open: boolean;
  onClose: () => void;
  host: Person;
  view: LiveView;
}) {
  const { requestJoin } = useJam();
  const [busy, setBusy] = useState(false);
  const live = view.state?.live ?? null;
  const lastLive = useRef(live);
  if (live) lastLive.current = live;
  const shown = lastLive.current;
  const now = useTicker(open && (shown?.is_playing ?? false));
  const name = personName(host);

  const join = async () => {
    setBusy(true);
    const ok = await requestJoin(host.telegram_user_id);
    setBusy(false);
    view.refresh();
    if (ok) onClose();
  };

  return (
    <Sheet floating open={open} onClose={onClose}>
      <SheetHead badge={<WaveBadge />} title="Join the Jam">
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 14 }}>Join {name}'s listening session?</div>
        <Copy>You'll start listening to their current track and stay in the jam for the next songs in the queue.</Copy>
      </SheetHead>
      {shown ? (
        <div style={{ padding: "20px 14px 0" }}>
          <SheetTrackCard
            track={shown.track}
            position={positionNow(
              shown.position_seconds,
              Date.parse(shown.position_at) - view.skew,
              shown.is_playing,
              shown.track.duration_seconds,
              now
            )}
          />
        </div>
      ) : null}
      <SheetActions>
        <JamButton disabled={busy} onClick={() => void join()}>
          Join Them
        </JamButton>
        <SheetSecondary onClick={onClose}>Cancel</SheetSecondary>
      </SheetActions>
    </Sheet>
  );
}

// --- Waiting, and answering: mounted once, in the shell -------------------------------------

/**
 * The sheets a jam request raises wherever the person happens to be in the
 * app: the requester's "waiting" sheet, and the host's accept/decline. Both
 * are driven by JamContext's poll, and both can be dismissed without
 * answering — a request left alone simply expires.
 */
export function JamSheets({ onJoined }: { onJoined: () => void }) {
  const { jam, incoming, outgoing, skew, cancelRequest, accept, decline, refresh } = useJam();
  const { current, position } = usePlayer();
  const { toast } = useToast();

  // --- The requester ---
  const [hiddenOutgoing, setHiddenOutgoing] = useState<string | null>(null);
  const pending = outgoing?.status === "pending" ? outgoing : null;
  const now = useTicker(pending != null);
  const expired = pending != null && now + skew > Date.parse(pending.expires_at) + REQUEST_GRACE_MS;

  // Past its expiry with no word from the server: stop waiting on screen and
  // ask once more, so the sheet can never sit there forever.
  useEffect(() => {
    if (expired) refresh();
  }, [expired, refresh]);

  const lastPending = useRef(pending);
  if (pending) lastPending.current = pending;
  const waitingOn = lastPending.current;
  const waitingOpen = pending != null && !expired && hiddenOutgoing !== pending.id;


  // How the request ended, said once.
  const watched = useRef<string | null>(null);
  useEffect(() => {
    if (!outgoing) return;
    if (outgoing.status === "pending") {
      watched.current = outgoing.id;
      return;
    }
    if (watched.current !== outgoing.id) return;
    watched.current = null;
    const name = personName(outgoing.host);
    if (outgoing.status === "accepted") {
      haptic.success();
      toast(`You're jamming with ${name}`);
      onJoined();
    } else if (outgoing.status === "declined") {
      haptic.warning();
      toast(`${name} declined`);
    } else if (outgoing.status === "expired") {
      toast(`No answer from ${name}`);
    }
  }, [outgoing, toast, onJoined]);

  // --- The host ---
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const asking = incoming.find((r) => !dismissed.has(r.id)) ?? null;
  const lastAsking = useRef(asking);
  if (asking) lastAsking.current = asking;
  const shownAsk = lastAsking.current;
  const [answering, setAnswering] = useState(false);

  const dismiss = (id: string) => setDismissed((s) => new Set(s).add(id));
  const answer = async (id: string, yes: boolean) => {
    setAnswering(true);
    if (yes) await accept(id);
    else await decline(id);
    setAnswering(false);
    dismiss(id);
  };

  // Announce a new request the moment it arrives, even if the sheet is what shows it.
  const seenAsk = useRef<string | null>(null);
  useEffect(() => {
    if (asking && seenAsk.current !== asking.id) {
      seenAsk.current = asking.id;
      haptic.warning();
    }
  }, [asking]);

  const hostTrack: JamTrack | null = current
    ? {
        id: current.id,
        title: current.title,
        artist: current.artist,
        duration_seconds: current.duration_seconds,
        cover_track_id: current.has_cover ? current.id : null,
        available: true,
        track: current,
      }
    : null;

  const listeners = jam ? jam.participants.length : 1;

  return (
    <>
      <Sheet floating closeButton={false} open={waitingOpen} onClose={() => pending && setHiddenOutgoing(pending.id)}>
        <SheetHead badge={<WaitingBadge />} title="Waiting for approval">
          <Copy>
            Your request has been sent to {personName(waitingOn?.host)}. They'll see it in Navaar and can accept or
            decline.
          </Copy>
        </SheetHead>
        <div style={{ display: "flex", padding: "36px 14px 0" }}>
          <SheetSecondary onClick={() => void cancelRequest()}>Cancel</SheetSecondary>
        </div>
      </Sheet>

      <Sheet floating open={asking != null} onClose={() => asking && dismiss(asking.id)}>
        {shownAsk ? (
          <>
            <SheetHead
              badge={
                <Avatar
                  userId={shownAsk.requester.telegram_user_id}
                  username={shownAsk.requester.handle ?? shownAsk.requester.username}
                  hasAvatar={shownAsk.requester.has_avatar}
                  size={80}
                />
              }
              title={personName(shownAsk.requester)}
            >
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>wants to join your jam</div>
              {listeners > 1 ? (
                <Copy>{listeners} of 4 already listening.</Copy>
              ) : null}
            </SheetHead>
            {hostTrack ? (
              <div style={{ padding: "22px 14px 0" }}>
                <div style={{ fontSize: 14, color: "var(--color-nav-muted)", marginBottom: 10 }}>
                  You're currently listening to:
                </div>
                <SheetTrackCard track={hostTrack} position={position} cover={60} />
              </div>
            ) : null}
            <SheetActions>
              <JamButton disabled={answering} onClick={() => void answer(shownAsk.id, true)}>
                Accept
              </JamButton>
              <SheetSecondary disabled={answering} onClick={() => void answer(shownAsk.id, false)}>
                Decline
              </SheetSecondary>
            </SheetActions>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

// --- In the player ----------------------------------------------------------------------------

const JAM_MAX = 4;

function isMe(person: Person, meId: number | string | undefined): boolean {
  return meId != null && person.telegram_user_id === String(meId);
}

/** Everyone in the jam, as a row of overlapping faces. */
function JamFaces({ size, ring }: { size: number; ring: string }) {
  const { jam } = useJam();
  if (!jam) return null;
  return (
    <span style={{ display: "flex", flex: "none" }}>
      {jam.participants.slice(0, JAM_MAX).map((p, i) => (
        <span
          key={p.person.telegram_user_id}
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size / 3), borderRadius: "50%", boxShadow: `0 0 0 2px ${ring}` }}
        >
          <Avatar
            userId={p.person.telegram_user_id}
            username={personName(p.person)}
            hasAvatar={p.person.has_avatar}
            size={size}
          />
        </span>
      ))}
    </span>
  );
}

/** Replaces "Playing from …" in the player's header while in a jam. */
export function JamHeader() {
  const { jam } = useJam();
  const { me } = useLibrary();
  if (!jam) return null;
  const others = jam.participants.filter((p) => !isMe(p.person, me?.id));
  // A guest is jamming with the host; the host with whoever joined first.
  const lead = jam.role === "guest" ? jam.host : (others[0]?.person ?? null);
  return (
    <span
      style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
    >
      <JamFaces size={18} ring="var(--color-nav-bg)" />
      <span
        className="nav-clip"
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-nav-jam-soft)",
        }}
      >
        {lead ? `Jamming with ${personName(lead)}` : "Jam open"}
      </span>
      <span className="nav-numeral" style={{ flex: "none", fontSize: 11, color: "var(--color-nav-action)" }}>
        {jam.participants.length}/{JAM_MAX}
      </span>
    </span>
  );
}

const JAM_EYEBROW: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-nav-action)",
  marginBottom: 4,
};

type JamConfirm = { kind: "end" | "leave" } | { kind: "remove"; person: Person };

const CONFIRM_COPY: Record<JamConfirm["kind"], { title: (c: JamConfirm) => string; body: string; action: string }> = {
  end: {
    title: () => "End the jam?",
    body: "Everyone goes back to their own music, and the jam queue is cleared.",
    action: "End Jam",
  },
  leave: {
    title: () => "Leave the jam?",
    body: "You go back to your own music. You'd have to ask to join again.",
    action: "Leave Jam",
  },
  remove: {
    title: (c) => `Remove ${c.kind === "remove" ? personName(c.person) : "them"} from the jam?`,
    body: "They go back to their own music, and can ask to join again.",
    action: "Remove",
  },
};

/**
 * The shared queue, in place of the player's own while in a jam: what is
 * playing, what comes next and who put it there, who is listening, and the
 * way out. Everyone can add; you can take back what you added; the host can
 * take anything out, move it, and remove people.
 */
export function JamQueuePane() {
  const { jam, leave, removeParticipant, removeQueueItem, moveQueueItem } = useJam();
  const { current, position, duration, isPlaying, status } = usePlayer();
  const { me, owns, playlists } = useLibrary();
  const keep = useKeepTrack();
  const [adding, setAdding] = useState(false);
  const [rowMenu, setRowMenu] = useState<JamQueueItem | null>(null);
  const [filing, setFiling] = useState<Track | null>(null);
  const [confirm, setConfirm] = useState<JamConfirm | null>(null);
  // Kept while the sheet animates out, so its words do not vanish first.
  const lastConfirm = useRef(confirm);
  if (confirm) lastConfirm.current = confirm;
  const asked = lastConfirm.current;
  if (!jam) return null;

  const hosting = jam.role === "host";
  const others = jam.participants.filter((p) => !isMe(p.person, me?.id));
  const unavailable = status === "unavailable";
  const mine = (item: JamQueueItem) => isMe(item.added_by, me?.id);
  const canRemove = (item: JamQueueItem) => hosting || mine(item);
  const menuIndex = rowMenu ? jam.queue.findIndex((q) => q.id === rowMenu.id) : -1;
  // The queue is a playlist everyone in the jam shares: any song on it can be
  // kept, whoever put it there.
  const menuTrack = rowMenu?.track.track ?? null;
  const hasMenu = (item: JamQueueItem) => item.track.track != null || canRemove(item);

  return (
    <div className="nav-scroll" style={{ flex: 1, minHeight: 0, padding: "4px 14px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 12px" }}>
        <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.015em" }}>Jam Queue</span>
        <button
          className="nav-press"
          onClick={() => {
            haptic.tap();
            setAdding(true);
          }}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 5,
            height: 32,
            padding: "0 12px",
            borderRadius: 16,
            background: "var(--color-nav-action)",
            color: "#0A0A0A",
            fontSize: 12,
            fontWeight: 600,
            boxShadow: "0 0 18px rgba(var(--color-nav-action-rgb),.3)",
          }}
        >
          <PlusIcon size={13} />
          Add Song
        </button>
      </div>

      {current ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 10,
            borderRadius: 14,
            border: "1.5px solid rgba(var(--color-nav-action-rgb),.8)",
            background: "rgba(var(--color-nav-action-rgb),.06)",
            boxShadow: "0 0 22px rgba(var(--color-nav-action-rgb),.12)",
          }}
        >
          <Cover trackId={current.id} hasCover={current.has_cover} size={58} radius={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--color-nav-action)",
                }}
              >
                {unavailable ? "Track unavailable" : "Now playing"}
              </span>
              <JamFaces size={18} ring="#0c0c0f" />
            </div>
            <div className="nav-clip" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {trackTitle(current)}
            </div>
            <div className="nav-clip" style={{ fontSize: 12, color: "var(--color-nav-muted)", margin: "1px 0 7px" }}>
              {trackArtist(current)}
            </div>
            <ProgressLine position={position} duration={duration || current.duration_seconds} />
          </div>
          <span
            style={{
              flex: "none",
              display: "grid",
              placeItems: "center",
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1.5px solid rgba(var(--color-nav-action-rgb),.8)",
              color: "var(--color-nav-action)",
            }}
          >
            <WaveIcon size={16} className={isPlaying ? "nav-pulse" : undefined} />
          </span>
        </div>
      ) : null}

      <div style={{ ...JAM_EYEBROW, marginTop: 18 }}>Next up</div>
      {jam.queue.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--color-nav-faint)", margin: "10px 0 0", lineHeight: 1.45 }}>
          Nothing queued yet. {hosting ? "Your own queue" : "The host's own queue"} carries on until somebody adds a
          song.
        </p>
      ) : (
        jam.queue.map((item, i) => (
          <JamQueueRow
            key={item.id}
            item={item}
            index={i}
            addedBy={mine(item) ? "You" : personName(item.added_by)}
            onMenu={hasMenu(item) ? () => setRowMenu(item) : undefined}
          />
        ))
      )}

      <div style={{ ...JAM_EYEBROW, marginTop: 20 }}>
        Listening · <span className="nav-numeral">{jam.participants.length}/{JAM_MAX}</span>
      </div>
      {jam.participants.map((p) => (
        <div key={p.person.telegram_user_id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46 }}>
          <Avatar
            userId={p.person.telegram_user_id}
            username={personName(p.person)}
            hasAvatar={p.person.has_avatar}
            size={30}
          />
          <span className="nav-clip" style={{ flex: 1, fontSize: 13.5 }}>
            {isMe(p.person, me?.id) ? "You" : personName(p.person)}
          </span>
          {p.role === "host" ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-nav-action)",
              }}
            >
              Host
            </span>
          ) : hosting ? (
            <button
              className="nav-press"
              aria-label={`Remove ${personName(p.person)} from the jam`}
              onClick={() => {
                haptic.tap();
                setConfirm({ kind: "remove", person: p.person });
              }}
              style={{ width: 40, height: 40, display: "grid", placeItems: "center", color: "var(--color-nav-muted)" }}
            >
              <CloseIcon size={15} />
            </button>
          ) : null}
        </div>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          marginTop: 16,
          padding: "11px 12px",
          borderRadius: 14,
          background: "rgba(var(--color-nav-jam-rgb),.16)",
          border: "1px solid rgba(var(--color-nav-jam-rgb),.4)",
        }}
      >
        <span
          style={{
            flex: "none",
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "1.5px solid var(--color-nav-jam)",
            color: "var(--color-nav-jam-soft)",
          }}
        >
          <SocialIcon size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-nav-jam-soft)" }}>You're in the jam</div>
          <div className="nav-clip" style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)", marginTop: 1 }}>
            {others.length === 0
              ? "Waiting for somebody to join"
              : `You and ${others.map((p) => personName(p.person)).join(", ")} are listening together`}
          </div>
        </div>
      </div>

      {/* Small and set apart: the way out should be findable, not somewhere a
          thumb lands on its way to the queue. */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
        <button
          className="nav-press"
          onClick={() => {
            haptic.tap();
            setConfirm({ kind: hosting ? "end" : "leave" });
          }}
          style={{
            height: 30,
            padding: "0 14px",
            borderRadius: 15,
            border: "1px solid rgba(255,255,255,.1)",
            color: "var(--color-nav-muted)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {hosting ? "End Jam" : "Leave Jam"}
        </button>
      </div>

      <AddSongSheet open={adding} onClose={() => setAdding(false)} />

      <Sheet open={rowMenu != null} onClose={() => setRowMenu(null)} title={rowMenu?.track.title ?? "Song"}>
        {menuTrack && !owns(menuTrack) ? (
          <SheetItem
            icon={LibraryIcon}
            label="Save to my Crate"
            onClick={() => {
              setRowMenu(null);
              void keep.save(menuTrack);
            }}
          />
        ) : null}
        {menuTrack ? (
          <SheetItem
            icon={PlaylistIcon}
            label="Add to playlist"
            onClick={() => {
              setRowMenu(null);
              void keep.fileable(menuTrack).then(setFiling);
            }}
          />
        ) : null}
        {hosting && menuIndex > 0 ? (
          <SheetItem
            icon={ArrowUpIcon}
            label="Move up"
            onClick={() => {
              if (rowMenu) void moveQueueItem(rowMenu.id, menuIndex - 1);
              setRowMenu(null);
            }}
          />
        ) : null}
        {hosting && menuIndex >= 0 && menuIndex < jam.queue.length - 1 ? (
          <SheetItem
            icon={ArrowDownIcon}
            label="Move down"
            onClick={() => {
              if (rowMenu) void moveQueueItem(rowMenu.id, menuIndex + 1);
              setRowMenu(null);
            }}
          />
        ) : null}
        {rowMenu && canRemove(rowMenu) ? (
          <SheetItem
            icon={TrashIcon}
            label="Remove from the jam"
            destructive
            onClick={() => {
              void removeQueueItem(rowMenu.id);
              setRowMenu(null);
            }}
          />
        ) : null}
      </Sheet>

      <AddToPlaylistSheet tracks={filing ? [filing] : []} playlists={playlists} onClose={() => setFiling(null)} />

      <Sheet open={confirm != null} onClose={() => setConfirm(null)} title={asked ? CONFIRM_COPY[asked.kind].title(asked) : ""}>
        <p style={{ fontSize: 13, color: "var(--color-nav-muted)", margin: "0 14px 12px", lineHeight: 1.45 }}>
          {asked ? CONFIRM_COPY[asked.kind].body : null}
        </p>
        <SheetItem
          icon={CloseIcon}
          label={asked ? CONFIRM_COPY[asked.kind].action : ""}
          destructive
          onClick={() => {
            setConfirm(null);
            haptic.warning();
            if (asked?.kind === "remove" && asked.person) void removeParticipant(asked.person.telegram_user_id);
            else void leave();
          }}
        />
      </Sheet>
    </div>
  );
}

function JamQueueRow({
  item,
  index,
  addedBy,
  onMenu,
}: {
  item: JamQueueItem;
  index: number;
  addedBy: string;
  onMenu?: () => void;
}) {
  const t = item.track;
  return (
    <div
      className="nav-row-in"
      style={{ "--i": index, display: "flex", alignItems: "center", gap: 11, minHeight: 62 } as React.CSSProperties}
    >
      <JamCover track={t} size={46} radius={7} style={{ opacity: t.available ? 1 : 0.45 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nav-clip" style={{ fontSize: 13.5, fontWeight: 600, opacity: t.available ? 1 : 0.55 }}>
          <span className="nav-numeral" style={{ color: "var(--color-nav-faint)", fontWeight: 400 }}>
            {index + 1}.
          </span>{" "}
          {t.title ?? "Untitled"}
        </div>
        <div className="nav-clip" style={{ fontSize: 12, color: "var(--color-nav-muted)", marginTop: 1 }}>
          {t.available ? (t.artist ?? "Unknown artist") : "Not available to you"}
        </div>
        <div className="nav-clip" style={{ fontSize: 10.5, color: "var(--color-nav-faint)", marginTop: 1 }}>
          Added by {addedBy}
        </div>
      </div>
      <span className="nav-numeral" style={{ flex: "none", fontSize: 11, color: "var(--color-nav-faint)" }}>
        {formatDuration(t.duration_seconds)}
      </span>
      {onMenu ? (
        <button
          className="nav-press"
          aria-label="Song options"
          onClick={() => {
            haptic.tap();
            onMenu();
          }}
          style={{
            flex: "none",
            width: 36,
            height: 44,
            display: "grid",
            placeItems: "center",
            color: "var(--color-nav-muted)",
          }}
        >
          <DotsIcon size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Your Crate, searchable, each row one tap from the jam queue. */
function AddSongSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tracks } = useLibrary();
  const { jam, addToQueue } = useJam();
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (open) return;
    setQuery("");
    setAdded(new Set());
  }, [open]);

  const needle = query.trim().toLowerCase();
  const shown = (
    needle ? tracks.filter((t) => `${trackTitle(t)} ${trackArtist(t)}`.toLowerCase().includes(needle)) : tracks
  ).slice(0, 60);
  const queued = new Set(jam?.queue.map((q) => q.track.id) ?? []);

  return (
    <Sheet open={open} onClose={onClose} title="Add to the jam">
      <div style={{ display: "flex", padding: "0 14px 8px" }}>
        <TextField value={query} onChange={setQuery} placeholder="Search your Crate" autoCorrect={false} />
      </div>
      <div className="nav-scroll" style={{ maxHeight: "52vh", padding: "0 8px" }}>
        {shown.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--color-nav-faint)", textAlign: "center", margin: "18px 0" }}>
            {tracks.length === 0 ? "Your Crate is empty." : "Nothing matches that."}
          </p>
        ) : (
          shown.map((track) => {
            const done = added.has(track.id) || queued.has(track.id);
            return (
              <button
                key={track.id}
                className="nav-press"
                disabled={done}
                aria-label={`Add ${trackTitle(track)} to the jam`}
                onClick={() => {
                  setAdded((s) => new Set(s).add(track.id));
                  void addToQueue(track);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  width: "100%",
                  minHeight: 54,
                  padding: "0 6px",
                  textAlign: "left",
                }}
              >
                <Cover trackId={track.id} hasCover={track.has_cover} size={40} radius={6} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="nav-clip" style={{ display: "block", fontSize: 13.5 }}>
                    {trackTitle(track)}
                  </span>
                  <span
                    className="nav-clip"
                    style={{ display: "block", fontSize: 11.5, color: "var(--color-nav-muted)" }}
                  >
                    {trackArtist(track)}
                  </span>
                </span>
                <span
                  style={{
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    color: done ? "var(--color-nav-action)" : "var(--color-nav-jam-soft)",
                    background: done ? undefined : "rgba(var(--color-nav-jam-rgb),.16)",
                  }}
                >
                  {done ? <CheckIcon size={15} /> : <PlusIcon size={15} />}
                </span>
              </button>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
