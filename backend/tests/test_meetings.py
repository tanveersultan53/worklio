"""Calendar: scheduling huddles, RSVPs, the channel card, ICS export and the alert sweep."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.db import SessionLocal
from app.meetings import _fold, deliver_due
from app.models import ActivityEvent, Meeting, Message


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _slot(minutes_from_now: int = 120, length: int = 30) -> tuple[str, str]:
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(minutes=minutes_from_now)
    return _iso(start), _iso(start + timedelta(minutes=length))


async def _schedule(client, team, *, who="alice", attendees=("bob",), minutes=120, **extra):
    start, end = _slot(minutes)
    body = {
        "title": "Launch sync",
        "starts_at": start,
        "ends_at": end,
        "attendee_ids": [team[a]["id"] for a in attendees],
        **extra,
    }
    return await client.post(
        f"/channels/{team['general']['id']}/meetings", json=body, headers=team[who]["headers"]
    )


async def test_schedule_posts_card_and_lists_on_calendar(client, team):
    r = await _schedule(client, team, description="Agenda: ship it", kind="video")
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["kind"] == "video" and m["status"] == "scheduled"
    assert {a["user_id"]: a["response"] for a in m["attendees"]} == {
        team["alice"]["id"]: "accepted",
        team["bob"]["id"]: "pending",
    }

    msgs = (
        await client.get(
            f"/channels/{team['general']['id']}/messages", headers=team["bob"]["headers"]
        )
    ).json()
    items = msgs["items"] if isinstance(msgs, dict) else msgs
    card = next(x for x in items if x["id"] == m["message_id"])
    assert card["kind"] == "system"
    assert card["meta"]["type"] == "meeting"
    assert card["meta"]["meeting"]["title"] == "Launch sync"

    start = datetime.now(UTC)
    params = {"start": _iso(start), "end": _iso(start + timedelta(days=7))}
    for who in ("alice", "bob"):
        cal = await client.get(
            f"/workspaces/{team['ws']['id']}/meetings", params=params, headers=team[who]["headers"]
        )
        assert cal.status_code == 200, cal.text
        assert [x["id"] for x in cal.json()] == [m["id"]]
    # Carol wasn't invited: not on her calendar, but she can open it (it's in #general).
    cal = await client.get(
        f"/workspaces/{team['ws']['id']}/meetings", params=params, headers=team["carol"]["headers"]
    )
    assert cal.json() == []
    r = await client.get(f"/meetings/{m['id']}", headers=team["carol"]["headers"])
    assert r.status_code == 200


async def test_invite_creates_activity(client, team):
    m = (await _schedule(client, team)).json()
    act = await client.get(
        f"/workspaces/{team['ws']['id']}/activity", headers=team["bob"]["headers"]
    )
    assert act.status_code == 200, act.text
    items = act.json()["items"]
    inv = [i for i in items if i["type"] == "meeting_invite"]
    assert inv and inv[0]["meta"]["meeting_id"] == m["id"]


async def test_validation(client, team):
    start, _ = _slot()
    bad_len = await client.post(
        f"/channels/{team['general']['id']}/meetings",
        json={"title": "x", "starts_at": start, "ends_at": start},
        headers=team["alice"]["headers"],
    )
    assert bad_len.status_code == 400
    past = await _schedule(client, team, minutes=-60)
    assert past.status_code == 400
    blank = await client.post(
        f"/channels/{team['general']['id']}/meetings",
        json={"title": "  ", "starts_at": start, "ends_at": _slot(150)[0]},
        headers=team["alice"]["headers"],
    )
    assert blank.status_code == 422
    stranger = await _schedule(client, team, attendees=())
    assert stranger.status_code == 201
    r = await client.post(
        f"/channels/{team['general']['id']}/meetings",
        json={
            "title": "x",
            "starts_at": start,
            "ends_at": _slot(150)[0],
            "attendee_ids": [str(uuid.uuid4())],
        },
        headers=team["alice"]["headers"],
    )
    assert r.status_code == 400


async def test_rsvp_updates_card(client, team):
    m = (await _schedule(client, team)).json()
    r = await client.put(
        f"/meetings/{m['id']}/rsvp", json={"response": "declined"}, headers=team["bob"]["headers"]
    )
    assert r.status_code == 200
    assert {a["user_id"]: a["response"] for a in r.json()["attendees"]}[team["bob"]["id"]] == "declined"
    # Someone not invited can say yes and joins the list.
    r = await client.put(
        f"/meetings/{m['id']}/rsvp", json={"response": "accepted"}, headers=team["carol"]["headers"]
    )
    assert team["carol"]["id"] in {a["user_id"] for a in r.json()["attendees"]}
    async with SessionLocal() as db:
        card = await db.get(Message, uuid.UUID(m["message_id"]))
        responses = {
            a["user_id"]: a["response"] for a in card.meta["meeting"]["attendees"]
        }
    assert responses[team["bob"]["id"]] == "declined"
    assert responses[team["carol"]["id"]] == "accepted"


async def test_only_organizer_or_admin_edits_and_cancels(client, team):
    m = (await _schedule(client, team, who="bob", attendees=("carol",))).json()
    r = await client.patch(
        f"/meetings/{m['id']}", json={"title": "Hijack"}, headers=team["carol"]["headers"]
    )
    assert r.status_code == 403
    start, end = _slot(300, 45)
    r = await client.patch(
        f"/meetings/{m['id']}",
        json={"title": "Moved", "starts_at": start, "ends_at": end, "attendee_ids": []},
        headers=team["bob"]["headers"],
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["title"] == "Moved"
    assert [a["user_id"] for a in out["attendees"]] == [team["bob"]["id"]]
    # Alice owns the workspace: she may cancel it.
    r = await client.post(f"/meetings/{m['id']}/cancel", headers=team["alice"]["headers"])
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    r = await client.put(
        f"/meetings/{m['id']}/rsvp", json={"response": "accepted"}, headers=team["bob"]["headers"]
    )
    assert r.status_code == 409


async def test_private_channel_hidden_from_outsiders(client, team):
    ch = (
        await client.post(
            f"/workspaces/{team['ws']['id']}/channels",
            json={"name": f"secret-{uuid.uuid4().hex[:6]}", "kind": "private"},
            headers=team["alice"]["headers"],
        )
    ).json()
    start, end = _slot()
    r = await client.post(
        f"/channels/{ch['id']}/meetings",
        json={"title": "Secret", "starts_at": start, "ends_at": end, "attendee_ids": [team["bob"]["id"]]},
        headers=team["alice"]["headers"],
    )
    assert r.status_code == 400  # bob isn't in the private channel
    r = await client.post(
        f"/channels/{ch['id']}/meetings",
        json={"title": "Secret", "starts_at": start, "ends_at": end},
        headers=team["alice"]["headers"],
    )
    m = r.json()
    assert (await client.get(f"/meetings/{m['id']}", headers=team["bob"]["headers"])).status_code == 404
    assert (
        await client.get(f"/meetings/{m['id']}/ics", headers=team["bob"]["headers"])
    ).status_code == 404


async def test_ics_export(client, team):
    m = (await _schedule(client, team, description="Line one\nLine, two; three")).json()
    r = await client.get(f"/meetings/{m['id']}/ics", headers=team["bob"]["headers"])
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    assert "attachment" in r.headers["content-disposition"]
    text = r.text
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert f"UID:{m['id']}@worklio" in text
    assert "SUMMARY:Launch sync" in text
    assert "Line one\\nLine\\, two\\; three" in text.replace("\r\n ", "")
    assert "METHOD:PUBLISH" in text and "STATUS:CONFIRMED" in text
    for line in text.split("\r\n"):
        assert len(line.encode()) <= 75

    await client.post(f"/meetings/{m['id']}/cancel", headers=team["alice"]["headers"])
    text = (await client.get(f"/meetings/{m['id']}/ics", headers=team["bob"]["headers"])).text
    assert "METHOD:CANCEL" in text and "STATUS:CANCELLED" in text and "SEQUENCE:1" in text


def test_fold_keeps_multibyte_characters_whole():
    line = "SUMMARY:" + "é" * 80
    folded = _fold(line)
    parts = folded.split("\r\n ")
    assert all(len(p.encode()) <= 75 for p in parts)
    assert "".join(parts) == line


async def test_sweep_reminds_then_rings_once(client, team):
    m = (await _schedule(client, team, minutes=60)).json()
    mid = uuid.UUID(m["id"])
    async with SessionLocal() as db:
        meeting = await db.get(Meeting, mid)
        starts = meeting.starts_at
    async with SessionLocal() as db:
        # 9 minutes before: reminder for alice and bob.
        assert await deliver_due(db, now=starts - timedelta(minutes=9)) >= 2
    async with SessionLocal() as db:
        reminders = list(
            await db.scalars(
                select(ActivityEvent).where(
                    ActivityEvent.type == "meeting_reminder",
                    ActivityEvent.meta["meeting_id"].astext == m["id"],
                )
            )
        )
        assert {str(e.user_id) for e in reminders} == {team["alice"]["id"], team["bob"]["id"]}
    async with SessionLocal() as db:
        # Already reminded: nothing more until the start.
        await deliver_due(db, now=starts - timedelta(minutes=8))
        again = await db.scalars(
            select(ActivityEvent).where(
                ActivityEvent.type == "meeting_reminder",
                ActivityEvent.meta["meeting_id"].astext == m["id"],
            )
        )
        assert len(list(again)) == 2
    async with SessionLocal() as db:
        rung = await deliver_due(db, now=starts + timedelta(seconds=10))
        assert rung >= 2
    async with SessionLocal() as db:
        meeting = await db.get(Meeting, mid)
        assert meeting.reminded_at and meeting.started_notified_at
        rang_at = meeting.started_notified_at
    async with SessionLocal() as db:
        await deliver_due(db, now=starts + timedelta(seconds=40))
        assert (await db.get(Meeting, mid)).started_notified_at == rang_at


async def test_reschedule_rearms_alerts(client, team):
    m = (await _schedule(client, team, minutes=60)).json()
    mid = uuid.UUID(m["id"])
    async with SessionLocal() as db:
        meeting = await db.get(Meeting, mid)
        await deliver_due(db, now=meeting.starts_at + timedelta(seconds=5))
    start, end = _slot(240)
    await client.patch(
        f"/meetings/{m['id']}",
        json={"starts_at": start, "ends_at": end},
        headers=team["alice"]["headers"],
    )
    async with SessionLocal() as db:
        meeting = await db.get(Meeting, mid)
        assert meeting.reminded_at is None and meeting.started_notified_at is None


async def test_free_busy_shows_times_only_and_respects_declines(client, team):
    # Far enough ahead that no other test's meeting overlaps this window.
    minutes = 60 * 24 * 9 + 37
    m = (await _schedule(client, team, minutes=minutes)).json()
    start = datetime.fromisoformat(m["starts_at"]) - timedelta(minutes=1)
    end = datetime.fromisoformat(m["ends_at"]) + timedelta(minutes=1)
    ids = [team[w]["id"] for w in ("alice", "bob", "carol")] + [str(uuid.uuid4())]

    async def busy(who="carol"):
        r = await client.get(
            f"/workspaces/{team['ws']['id']}/meetings/busy",
            params={"start": _iso(start), "end": _iso(end), "user_ids": ids},
            headers=team[who]["headers"],
        )
        assert r.status_code == 200, r.text
        return {row["user_id"]: row["busy"] for row in r.json()}

    got = await busy()
    # Strangers are dropped; the organizer and a pending invitee are busy, Carol is free.
    assert set(got) == {team["alice"]["id"], team["bob"]["id"], team["carol"]["id"]}
    assert len(got[team["alice"]["id"]]) == 1 and len(got[team["bob"]["id"]]) == 1
    assert got[team["carol"]["id"]] == []
    assert set(got[team["bob"]["id"]][0]) == {"start", "end"}

    r = await client.put(
        f"/meetings/{m['id']}/rsvp", json={"response": "declined"}, headers=team["bob"]["headers"]
    )
    assert r.status_code == 200, r.text
    assert (await busy())[team["bob"]["id"]] == []

    r = await client.get(
        f"/workspaces/{team['ws']['id']}/meetings/busy",
        params={"start": _iso(start), "end": _iso(start + timedelta(days=15)), "user_ids": ids[:1]},
        headers=team["alice"]["headers"],
    )
    assert r.status_code == 400
