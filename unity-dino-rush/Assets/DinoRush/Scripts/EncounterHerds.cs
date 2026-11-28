// Dilophosaurus spitting venom, Pachycephalosaurus head-butting, and herds of the same
// species with their own habits (migration, defensive ring, tail-swing threat, crest
// chorus, resting pack with a sentinel).
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public partial class EncounterDirector
    {
        void BuildNewcomers()
        {
            float S(string n) => T.SOf(n);
            // Dilophosaurus in the middle of the helix
            {
                var d = Add("dilo", 1.4f);
                d.Place(OnGround(new Vector3(-132, 0, -172)), 0);
                actors.Add(new Spitter(this, d, S("helix0") - 20, S("helixOut") + 10));
            }
            // Pachycephalosaurus pair butting heads + one that rams the cart on the brake run
            {
                float sAt = S("brake2") - 26;
                var A = Beside(sAt - 10, 13); var B = Beside(sAt - 10, 21);
                BuildButtPair(Add("pachy", 1f), Add("pachy", 0.95f), A, B);
                actors.Add(new Rammer(this, Add("pachy", 1.1f), sAt, -6));
            }
        }

        class Spitter : Base
        {
            readonly float s0, s1; float spitT = 2.5f; int spits;
            readonly List<(Transform m, Vector3 from, float t)> blobs = new List<(Transform, Vector3, float)>();
            Material blobMat;
            public Spitter(EncounterDirector e, DinoActor a, float s0, float s1) : base(e, a) { this.s0 = s0; this.s1 = s1; }
            public override void Tick(float dt)
            {
                bool inWin = E.DsTo(s0) < 0 && E.DsTo(s1) > 0;
                float dist = Vector3.Distance(d.pos, E.Cam);
                d.speed = 0;
                d.heading = AngleLerp(d.heading, Mathf.Atan2(E.Cam.x - d.pos.x, E.Cam.z - d.pos.z), Mathf.Min(1, dt * 2));
                d.lookTarget = E.Cam; d.lookWeight = inWin ? 1 : 0.3f;
                d.SetBool("Frill", inWin && dist < 60);
                for (int i = blobs.Count - 1; i >= 0; i--)
                {
                    var b = blobs[i];
                    b.t += dt / 0.55f;
                    float k = Mathf.Min(1, b.t);
                    b.m.position = Vector3.Lerp(b.from, E.Cam, k) + Vector3.up * Mathf.Sin(Mathf.PI * k) * 2;
                    blobs[i] = b;
                    if (k >= 1)
                    {
                        Object.Destroy(b.m.gameObject); blobs.RemoveAt(i);
                        if (E.Fx) E.Fx.Splat();
                        E.ride.Shake(0.3f); Haptics.Buzz(50);
                        if (E.audioDir) E.audioDir.Splash();
                        if (spits == 1) E.Say("으악! 끈적한 독침!");
                    }
                }
                if (!inWin) { spits = 0; spitT = 2.5f; return; }
                spitT -= dt;
                if (spitT < 0 && spits < 3 && dist < 45)
                {
                    spits++; spitT = 3 + Random.value * 1.5f;
                    d.Trigger("Spit"); d.Trigger("Attack");
                    if (E.audioDir) E.audioDir.Screech(d.HeadPos, 1.6f);
                    if (!blobMat) blobMat = MatUtil.Emissive(new Color(0.6f, 0.88f, 0.16f), new Color(0.2f, 0.35f, 0.03f), 1f);
                    var g = MatUtil.Prim(PrimitiveType.Sphere, null, d.HeadPos, Vector3.one * 0.18f, blobMat);
                    blobs.Add((g.transform, d.HeadPos, 0f));
                    if (spits == 1) E.Say("딜로포사우루스가 독침을 뱉는다!");
                }
            }
        }

        void BuildButtPair(DinoActor a, DinoActor b, Vector3 A, Vector3 B)
        {
            var mid = (A + B) * 0.5f;
            var dir = B - A; dir.y = 0; dir.Normalize();
            float hA = Mathf.Atan2(dir.x, dir.z), hB = Mathf.Atan2(-dir.x, -dir.z);
            a.Place(A, hA); b.Place(B, hB);
            float t = Random.value * 3; bool hit = false;
            void Step(DinoActor d, float sign, float dt)
            {
                float cyc = t % 6, off;
                if (cyc < 2.2f) off = Mathf.Lerp(1.6f, 7, cyc / 2.2f);                 // back off
                else if (cyc < 3.0f) off = 7;                                            // paw the ground
                else if (cyc < 3.7f) off = Mathf.Lerp(7, 1.15f, (cyc - 3.0f) / 0.7f);    // charge
                else off = 1.15f + Mathf.Min(0.8f, (cyc - 3.7f) * 1.5f);                // recoil
                var prev = d.pos;
                d.pos = OnGround(mid + dir * sign * off);
                d.speed = Vector3.Distance(prev, d.pos) / Mathf.Max(dt, 1e-3f);
                d.heading = sign < 0 ? hA : hB;
                d.bodyPitch = cyc > 2.8f && cyc < 3.8f ? 0.2f : 0;
                d.extraYaw = cyc > 3.7f && cyc < 4.6f ? Mathf.Sin(t * 25) * 0.12f : 0;
            }
            updaters.Add(dt =>
            {
                t += dt;
                Step(a, -1, dt); Step(b, 1, dt);
                float cyc = t % 6;
                if (cyc > 3.68f && !hit)
                {
                    hit = true;
                    if (Vector3.Distance(mid, Cam) < 120 && audioDir) { audioDir.Thump(mid, 1f); audioDir.Clunk(); }
                    FxPool.Dust(mid + Vector3.up * 1.2f, 20, 2);
                }
                if (cyc < 1) hit = false;
            });
        }

        class Rammer : Base
        {
            readonly float sAt, lat; Vector3 home; string state = "wait";
            public Rammer(EncounterDirector e, DinoActor a, float sAt, float lat) : base(e, a) { this.sAt = sAt; this.lat = lat; home = e.Beside(sAt + 4, lat * 2.2f); d.Place(home, 0); }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                if (state == "wait")
                {
                    d.speed = 0; d.lookTarget = E.Cam; d.lookWeight = ds < 40 && ds > -5 ? 1 : 0;
                    d.heading = Mathf.Atan2(E.Cam.x - d.pos.x, E.Cam.z - d.pos.z);
                    if (ds < 11 && ds > 0) { state = "charge"; t = 0; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 1.8f); }
                }
                else if (state == "charge")
                {
                    t += dt;
                    var sm = E.T.Sample(E.ride.S + 1.2f);
                    var tgt = sm.p + sm.r * Mathf.Sign(lat) * 1.6f;
                    d.MoveToward(tgt, 10, dt, 8, 30);
                    d.bodyPitch = 0.25f;
                    if (Vector3.Distance(d.pos, tgt) < 1.0f || t > 2.5f)
                    {
                        state = "dazed"; t = 0;
                        E.ride.Shake(1.3f); E.ride.Wobble(); E.ride.Kick(-Mathf.Sign(lat) * 1.6f);
                        if (E.audioDir) { E.audioDir.Crash(E.Cam, 0.9f); E.audioDir.Clunk(); }
                        Haptics.Buzz(new long[] { 0, 150, 40, 220 });
                        E.Say("쾅! 파키케팔로사우루스 박치기!");
                    }
                }
                else
                {
                    // bounces off, stumbles back and shakes its head
                    t += dt;
                    d.speed = Mathf.Max(0, 3 - t * 3);
                    d.pos -= new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    d.bodyPitch = 0; d.extraYaw = Mathf.Sin(t * 18) * 0.15f * Mathf.Max(0, 1 - t / 2.5f);
                    if (Mathf.Abs(ds) > 250) { d.extraYaw = 0; d.Place(home, 0); state = "wait"; }
                }
            }
        }

        // ---------------- herds ----------------
        class Herd
        {
            public string habit; public Vector3 c, A, B; public float t, u, alertT; public int callDone = -1;
            public List<Member> members = new List<Member>();
        }
        class Member { public DinoActor d; public bool juv; public int i; public DinoActor mom; public int lastCall = -1; }

        void BuildHerds()
        {
            float S(string n) => T.SOf(n);
            bool hi = !lowQuality;
            var A = OpenSpot(S("liftStart") + 25, 36, 22); var B = OpenSpot(S("liftTop") - 15, 36, 22);
            MakeHerd("brachio", A, hi ? 3 : 2, hi ? 2 : 1, "migrate", A, B);
            MakeHerd("trike", OpenSpot(S("trike") + 70, 36, 20), hi ? 5 : 4, hi ? 3 : 2, "ring");
            MakeHerd("stego", OpenSpot(S("hill") + 12, 30, 18), hi ? 3 : 2, 1, "tailswing");
            if (hi) MakeHerd("ankylo", OpenSpot(S("splash2") + 30, -30, 18), 2, 1, "tailswing");
            MakeHerd("parasaur", OpenSpot(S("lift2Start") - 15, -34, 20), hi ? 4 : 3, hi ? 2 : 1, "chorus");
            MakeHerd("raptor", OpenSpot(S("trim") + 8, 22, 14), hi ? 4 : 3, 0, "sentinel");
        }

        void MakeHerd(string key, Vector3 c, int nA, int nJ, string habit, Vector3 A = default, Vector3 B = default)
        {
            var G = new Herd { habit = habit, c = c, A = A, B = B, t = Random.value * 10 };
            WorldExtras.Clear(c, 26);
            if (habit == "migrate") for (float k = 0; k <= 1; k += 0.05f) WorldExtras.Clear(Vector3.Lerp(A, B, k), 10);
            int total = nA + nJ;
            for (int i = 0; i < total; i++)
            {
                bool juv = i >= nA;
                var d = Add(key, juv ? 0.38f + Random.value * 0.12f : 0.88f + Random.value * 0.2f);
                float ang = (float)i / total * Mathf.PI * 2, r = juv ? 2.5f : (habit == "ring" ? 7.5f : 6 + Random.value * 5);
                d.Place(OnGround(c + new Vector3(Mathf.Cos(ang) * r, 0, Mathf.Sin(ang) * r)), Random.value * 6);
                var m = new Member { d = d, juv = juv, i = i, mom = juv ? G.members[(i - nA) % nA].d : null };
                G.members.Add(m);
                actors.Add(new HerdMember(this, G, m));
            }
        }

        class HerdMember : Base
        {
            readonly Herd G; readonly Member m;
            public HerdMember(EncounterDirector e, Herd g, Member mem) : base(e, mem.d) { G = g; m = mem; }
            public override void Tick(float dt)
            {
                if (m.i == 0) { G.t += dt; G.alertT -= dt; }
                float dist = Vector3.Distance(d.pos, E.Cam);
                if (dist < 65) G.alertT = 3;
                bool alert = G.alertT > 0;
                var c = G.c;
                d.SetTailSwing(false); d.extraYaw = 0;
                switch (G.habit)
                {
                    case "migrate":
                    {
                        bool browse = (G.t % 26) > 17;
                        if (m.i == 0 && !browse) G.u += dt * 1.5f / Mathf.Max(1, Vector3.Distance(G.A, G.B));
                        float u = 0.5f - 0.5f * Mathf.Cos(Mathf.PI * G.u);
                        var dir = G.B - G.A; dir.y = 0; dir.Normalize();
                        float back = Mathf.Sin(Mathf.PI * G.u) >= 0 ? 1 : -1;
                        if (m.juv) d.MoveToward(m.mom.pos + new Vector3(-dir.z, 0, dir.x) * 4.5f, 2.6f, dt, 2, 2);
                        else d.MoveToward(Vector3.Lerp(G.A, G.B, u) - dir * back * m.i * 15, browse ? 0 : 1.9f, dt, 1, 1);
                        // adults raise their heads into the canopy, calves graze
                        d.SetEat(browse && d.speed < 0.3f);
                        d.bodyPitch = Mathf.Lerp(d.bodyPitch, browse && !m.juv ? -0.06f : 0, dt);
                        int cyc = Mathf.FloorToInt(G.t / 26);
                        if (browse && m.i == 0 && G.callDone != cyc && dist < 200) { G.callDone = cyc; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 0.42f); }
                        break;
                    }
                    case "ring":
                        if (m.juv)
                        {
                            d.MoveToward(c + new Vector3(Mathf.Cos(G.t * 0.3f + m.i * 2) * 2.5f, 0, Mathf.Sin(G.t * 0.3f + m.i * 2) * 2.5f), 1, dt, 2, 2);
                            d.SetEat(d.speed < 0.3f);
                        }
                        else
                        {
                            int nA = G.members.FindAll(x => !x.juv).Count;
                            float a = (float)m.i / nA * Mathf.PI * 2;
                            var tgt = c + new Vector3(Mathf.Cos(a) * 7.5f, 0, Mathf.Sin(a) * 7.5f);
                            d.MoveToward(tgt, 1.2f, dt, 2, 2);
                            if (Vector3.Distance(d.pos, tgt) < 1) d.heading = AngleLerp(d.heading, Mathf.Atan2(Mathf.Cos(a), Mathf.Sin(a)), dt * 2); // face outward
                            d.bodyPitch = alert ? 0.12f + Mathf.Sin(G.t * 6 + m.i) * 0.02f : 0; // horns lowered
                            d.SetEat(!alert && Mathf.Sin(G.t * 0.5f + m.i * 1.3f) > 0);
                            int cyc = Mathf.FloorToInt(G.t / 5);
                            if (alert && m.i == 0 && G.callDone != cyc) { G.callDone = cyc; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 1.2f); }
                        }
                        break;
                    case "tailswing":
                        if (alert && !m.juv)
                        {
                            // turn broadside to the threat and sweep the spiked tail
                            d.speed = Mathf.Max(0, d.speed - dt * 3);
                            d.heading = AngleLerp(d.heading, Mathf.Atan2(E.Cam.x - d.pos.x, E.Cam.z - d.pos.z) + Mathf.PI / 2, dt * 1.5f);
                            d.SetTailSwing(true);
                            d.bodyRoll = Mathf.Sin(G.t * 3.2f) * 0.05f; // body sways with the swing
                            int cyc = Mathf.FloorToInt(G.t / 4);
                            if (m.i == 0 && G.callDone != cyc) { G.callDone = cyc; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 1.3f); }
                        }
                        else if (alert && m.juv)
                        {
                            var away = c - E.Cam; away.y = 0;
                            d.MoveToward(c + away.normalized * 6, 3, dt, 3, 4); // the young hide behind the adults
                        }
                        else
                        {
                            d.bodyRoll = 0;
                            d.MoveToward(c + new Vector3(Mathf.Cos(G.t * 0.07f + m.i * 2) * 8, 0, Mathf.Sin(G.t * 0.07f + m.i * 2) * 8), m.juv ? 1.2f : 0.8f, dt, 1, 1);
                            d.SetEat(d.speed < 0.4f);
                        }
                        break;
                    case "chorus":
                    {
                        d.MoveToward(c + new Vector3(Mathf.Cos(G.t * 0.08f + m.i * 1.6f) * 9, 0, Mathf.Sin(G.t * 0.08f + m.i * 1.6f) * 9), m.juv ? 1.4f : 1, dt, 1, 1);
                        float cyc = G.t % 11, slot = m.i * 0.45f;
                        bool calling = cyc > slot && cyc < slot + 1.6f;
                        d.SetEat(!calling && d.speed < 0.5f);
                        d.bodyPitch = Mathf.Lerp(d.bodyPitch, calling ? -0.1f : 0, dt * 3); // raise the crest to call
                        int n = Mathf.FloorToInt(G.t / 11);
                        if (calling && m.lastCall != n && dist < 160)
                        {
                            m.lastCall = n; d.Trigger("Roar");
                            if (E.audioDir) E.audioDir.Bellow(d.HeadPos, (m.juv ? 2.8f : 1.9f) + m.i * 0.12f);
                        }
                        break;
                    }
                    case "sentinel":
                        d.speed = 0;
                        if (m.i == 0)
                        {
                            // the lookout stands tall and scans the forest
                            d.crouch = 0;
                            d.extraYaw = alert ? 0 : Mathf.Sin(G.t * 0.7f) * 0.9f;
                            d.lookTarget = E.Cam; d.lookWeight = alert ? 1 : 0;
                            int cyc = Mathf.FloorToInt(G.t / 3);
                            if (alert && G.callDone != cyc) { G.callDone = cyc; if (E.audioDir) E.audioDir.Screech(d.HeadPos, 1.1f); d.Trigger("Roar"); }
                        }
                        else
                        {
                            // the rest lie low until the alarm, then rise and stare
                            d.crouch = Mathf.MoveTowards(d.crouch, alert ? 0 : 1, dt * 3);
                            d.lookTarget = E.Cam; d.lookWeight = alert ? 1 : 0;
                            d.SetEat(!alert);
                        }
                        break;
                }
            }
        }
    }
}
