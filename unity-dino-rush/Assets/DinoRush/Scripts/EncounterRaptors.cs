// The raptor run: unseen calls while circling the helix, a pack that runs beside the cart
// and lunges in, one that boards the cart's nose until the airtime hill flings it off,
// one that leaps over the rider's head, and one that chases on the rails into the cave.
using UnityEngine;

namespace DinoRush
{
    public partial class EncounterDirector
    {
        void BuildRaptors()
        {
            float S(string n) => T.SOf(n);
            float s0 = S("raptor0") - 8, s1 = S("tunnelIn") - 3;
            // build-up: calls circling in the forest while corkscrewing down the helix
            float stalk0 = S("helix0") + 50, stalk1 = S("raptor0") - 6, nextCall = 0; bool said = false;
            updaters.Add(dt =>
            {
                float d0 = DsTo(stalk0), d1 = DsTo(stalk1);
                if (d0 < 0 && d1 > 0)
                {
                    if (!said) { said = true; Say("…숲속에서 뭔가 우리를 따라온다"); }
                    nextCall -= dt;
                    if (nextCall < 0 && audioDir)
                    {
                        nextCall = 0.9f + Random.value * 1.6f;
                        float a = Random.value * Mathf.PI * 2, r = 20 + Random.value * 25;
                        audioDir.Screech(Cam + new Vector3(Mathf.Cos(a) * r, -4, Mathf.Sin(a) * r), 0.75f + Random.value * 0.4f);
                    }
                }
                else if (d0 > 50) said = false;
            });
            var cfg = new[] { (-3f, 3.4f), (2f, -3.6f), (-8f, -4.6f), (0f, 4.4f), (-13f, 3.0f) };
            for (int i = 0; i < (lowQuality ? 3 : 5); i++) actors.Add(new Chaser(this, Add("raptor"), s0, s1, cfg[i].Item1, cfg[i].Item2, i));
            actors.Add(new Boarder(this, Add("raptor"), S("raptorBoard") - 12, S("hop2")));
            actors.Add(new OverLeaper(this, Add("raptor", 1.05f), S("raptor1") + 44));
        }

        class Chaser : Base
        {
            readonly float s0, s1, off, lat; readonly int i; Vector3 hide; string state = "hide"; float screechT, wob, lungeT, lunge;
            public Chaser(EncounterDirector e, DinoActor a, float s0, float s1, float off, float lat, int i) : base(e, a)
            {
                this.s0 = s0; this.s1 = s1; this.off = off; this.lat = lat; this.i = i;
                hide = e.Beside(s0 + 6, lat * 3.2f); d.Place(hide, 0);
                screechT = 1 + i * 0.7f; lungeT = 1.2f + i * 0.9f; wob = Random.value * 6;
            }
            public override void Tick(float dt)
            {
                float d0 = E.DsTo(s0), dE = E.DsTo(s1);
                if (state == "hide")
                {
                    d.speed = 0; d.lookTarget = E.Cam; d.lookWeight = d0 < 60 ? 1 : 0;
                    if (d0 < 4 + i * 2 && d0 > -40) { state = "run"; t = 0; if (i == 0) E.Say("랩터 무리다!! 사방에서 달려든다!"); }
                }
                else if (state == "run")
                {
                    t += dt;
                    // take turns lunging at the rider: close in, jaws wide, snap, the rider flinches away
                    lungeT -= dt;
                    if (lungeT < 0 && lunge <= 0)
                    {
                        lunge = 0.5f; lungeT = 2.2f + Random.value * 2.5f + i * 0.3f;
                        d.Trigger("Attack");
                        if (E.audioDir) E.audioDir.Screech(d.HeadPos, 0.9f + Random.value * 0.4f);
                        E.ride.Shake(0.35f); E.ride.Kick(-Mathf.Sign(lat) * 0.35f); Haptics.Buzz(60);
                    }
                    float lk = lunge > 0 ? Mathf.Sin(Mathf.PI * (1 - lunge / 0.5f)) : 0;
                    lunge -= dt;
                    var target = E.Beside(E.ride.S + off + Mathf.Sin(t * 0.8f + wob) * 2 + lk * (2 - off * 0.3f), (lat + Mathf.Sin(t * 1.3f + wob) * 0.6f) * (1 - 0.45f * lk));
                    d.MoveToward(target, 23, dt, 6, 22);
                    d.lookTarget = E.Cam; d.lookWeight = 1;
                    screechT -= dt;
                    if (screechT < 0) { screechT = 1.8f + Random.value * 2.5f; if (E.audioDir) E.audioDir.Screech(d.HeadPos, 0.85f + Random.value * 0.4f); }
                    if (dE < 0) { state = i == 0 ? "tail" : "stop"; t = 0; if (i == 0) E.Say("한 마리가 터널까지 쫓아온다!"); }
                }
                else if (state == "tail")
                {
                    // right behind the cart on the rails, into the dark cave, until the launch
                    t += dt;
                    var sm = E.T.Sample(E.ride.S - 5.5f - Mathf.Max(0, t - 2.5f) * 6);
                    d.pos = sm.p + sm.u * 0.2f;
                    d.heading = Mathf.Atan2(sm.t.x, sm.t.z);
                    d.speed = E.ride.Speed * 1.05f;
                    d.lookTarget = E.Cam; d.lookWeight = 1;
                    screechT -= dt;
                    if (screechT < 0) { screechT = 1.2f + Random.value; if (E.audioDir) E.audioDir.Screech(d.HeadPos, 1f); d.Trigger("Attack"); }
                    if (E.T.InRange(E.ride.S, "launch") || t > 7) { state = "stop"; t = 0; }
                }
                else
                {
                    d.speed = Mathf.Max(0, d.speed - dt * 12);
                    d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    if (Mathf.Abs(d0) > 260) { d.Place(hide, 0); state = "hide"; }
                }
            }
        }

        class Boarder : Base
        {
            readonly float sJump, sOff; Vector3 home, from, vel; string state = "wait"; float snapT, side = 1;
            public Boarder(EncounterDirector e, DinoActor a, float sJump, float sOff) : base(e, a)
            {
                this.sJump = sJump; this.sOff = sOff;
                home = e.Beside(sJump + 6, 10); d.Place(home, 0);
            }
            Vector3 Nose(out TrackSample sm) { sm = E.T.Sample(E.ride.S); return sm.p + sm.t * 2.3f + sm.u * 0.95f; }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sJump);
                TrackSample sm;
                switch (state)
                {
                    case "wait":
                        d.speed = 0; d.lookTarget = E.Cam; d.lookWeight = ds < 40 && ds > -5 ? 1 : 0;
                        if (ds < 9 && ds > -2) { state = "leap"; t = 0; from = d.pos; if (E.audioDir) E.audioDir.Screech(d.HeadPos, 1.15f); }
                        break;
                    case "leap":
                    {
                        t += dt;
                        float k = Mathf.Clamp01(t / 0.65f);
                        var nose = Nose(out sm);
                        d.pos = Vector3.Lerp(from, nose, k * k * (3 - 2 * k)) + Vector3.up * Mathf.Sin(Mathf.PI * k) * 3;
                        d.heading = Mathf.Atan2(-sm.t.x, -sm.t.z);
                        d.Trigger("Attack");
                        if (k >= 1)
                        {
                            state = "ride"; t = 0;
                            E.ride.Shake(1.0f); E.ride.Wobble(); E.ride.Kick(0.8f);
                            if (E.audioDir) { E.audioDir.Thump(E.Cam, 1.2f); E.audioDir.Clunk(); }
                            Haptics.Buzz(new long[] { 0, 200, 50, 120 });
                            E.Say("랩터가 열차에 올라탔다!!");
                        }
                        break;
                    }
                    case "ride":
                    {
                        // clinging to the nose, face to face with the rider, snapping
                        t += dt; snapT -= dt;
                        d.pos = Nose(out sm);
                        d.heading = Mathf.Atan2(-sm.t.x, -sm.t.z) + Mathf.Sin(t * 5) * 0.15f;
                        d.bodyPitch = 0.25f + Mathf.Sin(t * 9) * 0.05f;
                        d.speed = 2.5f; d.lookTarget = E.Cam; d.lookWeight = 1;
                        if (snapT < 0)
                        {
                            snapT = 0.55f + Random.value * 0.35f;
                            d.Trigger("Attack"); E.ride.Shake(0.45f); E.ride.Flash(0.25f); Haptics.Buzz(70);
                            if (Random.value < 0.6f && E.audioDir) E.audioDir.Screech(d.HeadPos, 1 + Random.value * 0.3f);
                        }
                        if (E.ride.S > sOff - 4 || t > 4.5f)
                        {
                            // the airtime hill flings it off
                            state = "thrown"; t = 0; side = Random.value < 0.5f ? -1 : 1;
                            vel = sm.t * E.ride.Speed * 0.45f + sm.r * side * 7 + Vector3.up * 6;
                            d.bodyPitch = 0; E.ride.Shake(0.8f); E.ride.Kick(-side * 0.9f);
                            if (E.audioDir) E.audioDir.Screech(d.HeadPos, 1.4f);
                            E.Say("날려버렸다!!");
                        }
                        break;
                    }
                    case "thrown":
                    {
                        t += dt;
                        vel += Vector3.down * 9.81f * dt;
                        d.pos += vel * dt;
                        d.bodyPitch += dt * 6 * side; d.bodyRoll += dt * 9;
                        float g = E.Ground(d.pos);
                        if (d.pos.y < g && vel.y < 0) { d.pos.y = g; state = "down"; d.bodyPitch = 0; d.bodyRoll = Mathf.PI / 2; FxPool.Dust(d.pos, 40, 3); }
                        break;
                    }
                    case "down":
                        d.speed = 0;
                        if (Mathf.Abs(ds) > 300) { d.bodyRoll = 0; d.Place(home, 0); state = "wait"; }
                        break;
                }
            }
        }

        // charges down the track at the cart and leaps right over the rider's head
        class OverLeaper : Base
        {
            readonly float sAt; Vector3 start; string state = "wait"; bool warned, passed;
            public OverLeaper(EncounterDirector e, DinoActor a, float sAt) : base(e, a) { this.sAt = sAt; start = e.Beside(sAt + 16, 0); d.Place(start, 0); }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                if (state == "wait")
                {
                    var sm = E.T.Sample(sAt + 16);
                    d.heading = Mathf.Atan2(-sm.t.x, -sm.t.z);
                    d.speed = 0; d.lookTarget = E.Cam; d.lookWeight = ds < 60 ? 1 : 0;
                    if (ds < 60 && ds > 30 && !warned) { warned = true; E.Say("앞에 랩터가 서 있다!!"); if (E.audioDir) E.audioDir.Screech(d.HeadPos, 0.9f); }
                    if (ds < 13 && ds > -2) { state = "jump"; t = 0; }
                }
                else if (state == "jump")
                {
                    t += dt;
                    float k = Mathf.Clamp01(t / 0.85f);
                    var sm = E.T.Sample(E.ride.S + Mathf.Lerp(9, -9, k));
                    d.pos = sm.p + sm.u * (0.6f + Mathf.Sin(Mathf.PI * k) * 2.6f) + sm.r * 0.4f;
                    d.heading = Mathf.Atan2(-sm.t.x, -sm.t.z);
                    d.speed = 4; d.Trigger("Attack");
                    if (k > 0.42f && !passed)
                    {
                        passed = true;
                        E.ride.Shake(0.9f); E.ride.Flash(0.4f); Haptics.Buzz(new long[] { 0, 90, 40, 90 });
                        if (E.audioDir) { E.audioDir.Screech(E.Cam, 1.3f); E.audioDir.Thump(E.Cam, 0.8f); }
                        E.Say("머리 위로 뛰어넘었다!!");
                    }
                    if (k >= 1) { state = "land"; t = 0; d.pos.y = E.Ground(d.pos); FxPool.Dust(d.pos, 50, 3); }
                }
                else if (state == "land")
                {
                    t += dt;
                    d.MoveToward(E.Beside(E.ride.S - 6, -4), 20, dt, 4, 14);
                    d.lookTarget = E.Cam; d.lookWeight = 1;
                    if (t > 4) state = "idle";
                }
                else
                {
                    d.speed = Mathf.Max(0, d.speed - dt * 10);
                    if (Mathf.Abs(ds) > 260) { warned = passed = false; d.Place(start, 0); state = "wait"; }
                }
            }
        }
    }
}
