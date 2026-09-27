"""Render the overview pane: the orchestrator's plan file plus live agents.
Pure text in, text out; team-overview does the I/O."""
import re
import unicodedata

SECTIONS = ("DONE", "RUNNING", "NEXT")
ITEM = re.compile(r"^\s*[-*]\s+(\[[xX> ]\].*?)\s*$")


def _char_width(ch):
    if unicodedata.combining(ch) or unicodedata.category(ch) == "Cf":
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def display_width(text):
    """The text's width in terminal columns: wide characters (CJK, most
    emoji) count 2, combining and zero-width format characters count 0."""
    return sum(_char_width(ch) for ch in text)


def parse_plan(text):
    """The title and the item lines per section of a plan file. Headings match
    in any case; lines that are not items are dropped."""
    title, items, section = "", {s: [] for s in SECTIONS}, None
    for line in text.splitlines():
        if line.startswith("# ") and not title:
            title = line[2:].strip()
        elif line.startswith("## "):
            section = line[3:].strip().upper()
        else:
            m = ITEM.match(line)
            if m and section in items:
                items[section].append((" " + m.group(1)).replace("\t", " "))
    return title, items


def agent_lines(agents):
    if agents is None:
        return ["AGENTS", " herdr unavailable"]
    if not agents:
        return ["AGENTS", " (none)"]
    widths = [max(display_width(row[i]) for row in agents) for i in range(3)]
    pad = lambda c, w: c + " " * (w - display_width(c))
    return ["AGENTS"] + [" " + "  ".join([pad(c, w) for c, w in zip(row, widths)] + [row[3]])
                         for row in agents]


def cut(line, width):
    """`line` cut to at most `width` display columns, with a trailing … when
    cut. Never splits a wide character so the result goes over `width`."""
    if display_width(line) <= width:
        return line
    out, w, budget = [], 0, width - 1
    for ch in line:
        cw = _char_width(ch)
        if w + cw > budget:
            break
        out.append(ch)
        w += cw
    return "".join(out) + "…"


def frame(plan, plan_path, agents, width, height):
    """The pane text. When it is taller than `height`, DONE gives up its oldest
    items first; nothing else is dropped. Every line is cut to `width`."""
    tail = agent_lines(agents)
    if plan is None:
        lines = ["no plan yet: %s" % plan_path] + tail
    else:
        title, items = parse_plan(plan)
        head = [title, "=" * display_width(title)] if title else []
        middle = ["RUNNING"] + items["RUNNING"] + ["NEXT"] + items["NEXT"]
        done = items["DONE"]
        room = max(height - len(head) - 1 - len(middle) - len(tail), 0)
        shown = done[len(done) - room:] if room < len(done) else done
        heading = "DONE" if len(shown) == len(done) else "DONE (+%d earlier)" % (len(done) - len(shown))
        lines = head + [heading] + shown + middle + tail
    return "\n".join(cut(l, width) for l in lines)
