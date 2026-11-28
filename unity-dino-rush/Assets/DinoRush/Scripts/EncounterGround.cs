// Ground encounters: grazers, ambushers, the river riser, the watcher, the stampede (with
// rail leaps and the ram), T-Rex feeding with juveniles and scavengers, the Carnotaurus hunt.
using UnityEngine;

namespace DinoRush
{
    public partial class EncounterDirector
    {
        class Grazer : Base
        {
            readonly Vector3 anchor; readonly float radius, spd; readonly Vector3? drink; float callT;
            public Grazer(EncounterDirector e, DinoActor a, Vector3 anchor, float radius, float spd, Vector3? drink) : base(e, a)
            { this.anchor = anchor; this.radius = radius; this.spd = spd; this.drink = drink; t = Random.value * 10; callT = 6 + Random.value * 10; }
            public override void Tick(float dt)
            {
                t += dt; callT -= dt;
                if (drink.HasValue)
                {
                    // long neck down to the water, drink, lift and look around
                    d.speed = 0; d.heading = Mathf.Atan2(drink.Value.x - d.pos.x, drink.Value.z - d.pos.z);
                    float cyc = t % 16;
                    bool down = cyc < 9;
                    d.SetEat(down);
                    d.bodyPitch = Mathf.Lerp(d.bodyPitch, down ? 0.12f : 0, dt * 2);
                    if (down && cyc > 3 && Random.value < dt * 0.6f) FxPool.Water(d.HeadPos, 4, 1.2f);
                    return;
                }
                float w = spd / radius;
                var target = anchor + new Vector3(Mathf.Cos(t * w) * radius, 0, Mathf.Sin(t * w) * radius);
                bool walk = Mathf.Sin(t * 0.13f) > -0.3f;
                d.MoveToward(target, walk ? spd : 0, dt, 0.8f, 1);
                d.SetEat(!walk || Mathf.Sin(t * 0.4f) > 0.2f);
                float dist = Vector3.Distance(d.pos, E.Cam);
                d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, dist < 70 ? 0.7f : 0, dt * 0.5f);
                if (callT < 0 && dist < 250) { callT = 10 + Random.value * 14; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, d.roarPitch * 1.6f); }
            }
        }

        class Ambusher : Base
        {
            readonly float sAt, lat, roarAt, chaseSecs, chaseSpeed; readonly bool big; readonly string msg;
            Vector3 home; float homeHeading; string state = "wait"; bool roared, roar2;
            public Ambusher(EncounterDirector e, DinoActor a, float sAt, float lat, float roarAt, float chaseSecs, float chaseSpeed, bool big, string msg) : base(e, a)
            {
                this.sAt = sAt; this.lat = lat; this.roarAt = roarAt; this.chaseSecs = chaseSecs; this.chaseSpeed = chaseSpeed; this.big = big; this.msg = msg;
                home = e.Beside(sAt, lat);
                var aim = e.Beside(sAt - 7, 0);
                homeHeading = Mathf.Atan2(aim.x - home.x, aim.z - home.z);
                d.Place(home, homeHeading);
            }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt), sc = d.scale;
                if (state == "wait")
                {
                    d.speed = 0;
                    d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, ds < 160 && ds > -5 ? 1 : 0, dt * 0.8f);
                    if (!roared && ds < roarAt && ds > 0) { roared = true; E.Roar(d); E.ride.Shake(0.25f); E.Say(msg); }
                    if (ds < 26 && ds > -2)
                    {
                        float k = Mathf.Clamp01(1 - ds / 26);
                        var toTrack = E.Beside(sAt, 0) - home; toTrack.y = 0;
                        d.pos = E.OnGround(home + toTrack.normalized * 1.6f * k * sc);
                        d.bodyPitch = 0.12f * k;
                        d.Trigger("Attack");
                    }
                    if (ds <= 0.8f && ds > -10) { E.Hit(big ? 1.1f : 0.85f); E.Roar(d, 1.1f); state = "chase"; t = 0; d.bodyPitch = 0; }
                }
                else if (state == "chase")
                {
                    t += dt;
                    var target = E.Beside(E.ride.S - 9 * sc, Mathf.Sign(lat) * (6 + 2 * sc));
                    d.MoveToward(target, chaseSpeed * sc, dt, 3, 9);
                    d.lookTarget = E.Cam; d.lookWeight = 1;
                    if (t > chaseSecs || Vector3.Distance(d.pos, E.Cam) > 55) { state = "stop"; t = 0; }
                }
                else if (state == "stop")
                {
                    t += dt;
                    d.speed = Mathf.Max(0, d.speed - dt * 10);
                    d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    if (!roar2 && t > 0.8f) { roar2 = true; E.Roar(d, 0.9f); }
                    if (t > 6) { state = "home"; t = 0; }
                }
                else if (state == "home")
                {
                    if (Mathf.Abs(ds) > 200) { d.Place(home, homeHeading); d.speed = 0; state = "wait"; roared = roar2 = false; d.lookWeight = 0; }
                    else d.MoveToward(home, 4 * sc, dt, 1.5f, 2);
                }
            }
        }

        class Riser : Base
        {
            readonly float sAt; readonly bool late; Vector3 home; string state = "hidden"; bool roared;
            const float YLow = -9f, YUp = -1.9f;
            public Riser(EncounterDirector e, DinoActor a, float sAt, float lat, bool lateTrigger) : base(e, a)
            {
                this.sAt = sAt; late = lateTrigger; home = e.Beside(sAt, lat, false);
                var aim = e.Beside(sAt - 10, 0, false);
                d.swim = true;
                d.Place(new Vector3(home.x, YLow, home.z), Mathf.Atan2(aim.x - home.x, aim.z - home.z));
                d.gameObject.SetActive(false);
                e.keepActive.Add(d);
            }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                if (state == "hidden")
                {
                    d.pos.y = YLow;
                    if (ds < (late ? 30 : 95) && ds > (late ? 6 : 20)) { state = "rise"; t = 0; d.gameObject.SetActive(true); if (E.audioDir) E.audioDir.Splash(); FxPool.Water(new Vector3(home.x, 0.2f, home.z), 220, 9); }
                }
                else if (state == "rise")
                {
                    t += dt;
                    float k = Mathf.Clamp01(t / 1.3f);
                    d.pos.y = Mathf.Lerp(YLow, YUp, 1 - Mathf.Pow(1 - k, 3));
                    d.lookTarget = E.Cam; d.lookWeight = Mathf.Min(1, d.lookWeight + dt);
                    if (!roared && t > 0.7f) { roared = true; E.Roar(d); E.Say("강에서 스피노사우루스가!!"); }
                    if (ds < 22) d.Trigger("Attack");
                    if (ds < 0.5f) { E.Hit(0.8f); if (E.audioDir) E.audioDir.Splash(); FxPool.Water(E.Cam + Vector3.down, 160, 6); if (E.Fx) E.Fx.Drops(); state = "after"; t = 0; }
                }
                else if (state == "after") { t += dt; if (Mathf.Abs(ds) > 150) { state = "sink"; t = 0; } }
                else if (state == "sink")
                {
                    t += dt;
                    d.pos.y = Mathf.Lerp(YUp, YLow, Mathf.Clamp01(t / 3));
                    if (t > 3) { state = "hidden"; roared = false; d.gameObject.SetActive(false); }
                }
            }
        }

        class Watcher : Base
        {
            readonly float sAt; bool called;
            public Watcher(EncounterDirector e, DinoActor a, float sAt) : base(e, a) { this.sAt = sAt; }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                bool near = ds < 70 && ds > -40;
                d.speed = 0;
                d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, near ? 0.55f : 0, dt * 0.5f);
                if (near && !called && ds < 30) { called = true; d.Trigger("Roar"); if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 0.42f); E.Say("브라키오사우루스가 인사한다"); }
                if (!near && Mathf.Abs(ds) > 200) called = false;
            }
        }

        // charges in from ~110 m, bounds over the rails, the leader rams the cart
        class Charger : Base
        {
            readonly float sAt, spd, runTime; readonly bool lead; Vector3 A, B;
            string state = "wait"; bool bellowed, bumped, jumping; float stagger, staggerSide, plumeT;
            readonly Vector3 P0, R0; readonly float dirSign, halfW, railAbove;
            public Charger(EncounterDirector e, DinoActor a, float sAt, float latA, float latB, bool lead) : base(e, a)
            {
                this.sAt = sAt; this.lead = lead;
                A = e.Beside(sAt, latA); B = e.Beside(sAt, latB);
                for (float k = 0; k <= 1; k += 0.04f) WorldExtras.Clear(Vector3.Lerp(A, B, k), 5); // stampede lane
                spd = 11.5f * Mathf.Pow(a.scale, 0.3f);
                runTime = Mathf.Abs(latA) / spd + spd / 8f;
                d.Place(A, Mathf.Atan2(B.x - A.x, B.z - A.z));
                var sm0 = e.T.Sample(sAt);
                P0 = sm0.p; R0 = sm0.r;
                dirSign = Mathf.Sign(latB - latA);
                halfW = 4 + 4 * a.scale;
                railAbove = P0.y - e.Ground(P0);
            }
            void Jump()
            {
                float latNow = (d.pos.x - P0.x) * R0.x + (d.pos.z - P0.z) * R0.z;
                float u = (latNow * dirSign + halfW) / (2 * halfW);
                if (u > 0 && u < 1 && railAbove < 2.6f)
                {
                    float g = E.Ground(d.pos);
                    float lift = Mathf.Max(0, P0.y + 0.4f - g) + 1.3f * d.scale;
                    d.pos.y = g + lift * Mathf.Sin(Mathf.PI * u);
                    d.bodyPitch = -0.32f * Mathf.Cos(Mathf.PI * u);
                    if (!jumping) { jumping = true; FxPool.Dust(d.pos, 45, 4); if (E.audioDir) E.audioDir.Thump(d.pos, 0.7f); }
                }
                else if (jumping && u >= 1)
                {
                    jumping = false; d.bodyPitch = 0;
                    FxPool.Dust(d.pos, 70, 5); FxPool.Plume(d.pos + Vector3.up, 3 * d.scale, new Color(0.6f, 0.52f, 0.4f, 0.6f));
                    float dist = Vector3.Distance(d.pos, E.Cam);
                    if (E.audioDir) E.audioDir.Thump(d.pos, 1.2f);
                    if (dist < 40) { E.ride.Shake(0.5f * (1 - dist / 40)); Haptics.Buzz(80); }
                }
            }
            public override void Tick(float dt)
            {
                float ds = E.DsTo(sAt);
                if (state == "wait")
                {
                    d.speed = 0; d.SetEat(true);
                    if (ds < 450 && ds > 0 && E.Eta(sAt) < runTime + (lead ? 0.28f : 1.3f)) { state = "run"; t = 0; bumped = jumping = false; d.SetEat(false); }
                }
                else if (state == "run")
                {
                    t += dt;
                    if (stagger > 0)
                    {
                        stagger -= dt;
                        d.speed += (4 - d.speed) * Mathf.Min(1, dt * 3);
                        d.heading += staggerSide * dt * 1.1f;
                        d.extraYaw = Mathf.Sin(t * 14) * 0.25f * stagger;
                        d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                        if (stagger <= 0) d.extraYaw = 0;
                    }
                    else d.MoveToward(B, spd, dt, 1.2f, 4);
                    Jump();
                    plumeT -= dt;
                    if (plumeT < 0) { plumeT = 0.22f; FxPool.Plume(d.pos + Vector3.up, 3 * d.scale, new Color(0.6f, 0.52f, 0.4f, 0.55f)); FxPool.Dust(d.pos, 6, 2); }
                    if (!bellowed && t > 0.2f) { bellowed = true; if (E.audioDir) E.audioDir.Bellow(d.HeadPos, 1.3f / d.scale); if (lead) E.Say("저 멀리서 트리케라톱스 무리가 돌진해 온다!"); }
                    if (!bumped && Vector3.Distance(d.pos, E.Cam) < (lead ? 8 : 6))
                    {
                        bumped = true;
                        var sm = E.T.Sample(E.ride.S);
                        float side = Mathf.Sign(Vector3.Dot(d.pos - E.Cam, sm.r)); if (side == 0) side = 1;
                        if (lead)
                        {
                            E.ride.Shake(2.2f); E.ride.Wobble(); E.ride.Kick(2.4f * side); E.ride.Slow(); E.ride.Flash(0.5f);
                            E.StartCoroutine(Aftershock(-1.1f * side));
                            if (E.audioDir) { E.audioDir.Crash(E.Cam, 1.3f); E.audioDir.Bellow(d.HeadPos, 1.1f); }
                            FxPool.Dust(E.Cam + sm.r * side * 1.5f + Vector3.down, 160, 6);
                            Haptics.Buzz(new long[] { 0, 350, 60, 200, 60, 400 });
                            E.Say("쾅!!! 트리케라톱스에게 들이받혔다!");
                            stagger = 1.4f; staggerSide = side;
                        }
                        else { E.ride.Shake(0.9f); E.ride.Kick(0.8f * side); if (E.audioDir) E.audioDir.Crash(d.pos, 0.6f); Haptics.Buzz(120); }
                    }
                    if (Vector3.Distance(d.pos, B) < 2) { state = "done"; t = 0; }
                }
                else if (state == "done")
                {
                    d.speed = Mathf.Max(0, d.speed - dt * 6);
                    d.pos += new Vector3(Mathf.Sin(d.heading), 0, Mathf.Cos(d.heading)) * d.speed * dt; d.pos.y = E.Ground(d.pos);
                    if (d.speed < 0.1f) d.SetEat(true);
                    if (Mathf.Abs(ds) > 450) { d.Place(A, Mathf.Atan2(B.x - A.x, B.z - A.z)); state = "wait"; bellowed = false; }
                }
            }
            System.Collections.IEnumerator Aftershock(float side)
            {
                yield return new WaitForSeconds(0.26f);
                E.ride.Kick(side); E.ride.Shake(1.2f);
                if (E.audioDir) E.audioDir.Clunk();
            }
        }

        class Feeder : Base
        {
            float roarCD;
            public Feeder(EncounterDirector e, DinoActor a) : base(e, a) { t = Random.value * 6; }
            public override void Tick(float dt)
            {
                t += dt; roarCD -= dt;
                d.speed = 0;
                float dist = Vector3.Distance(d.pos, E.Cam);
                if (dist < 70 && roarCD < 0) { roarCD = 16; E.Roar(d); E.Say("티라노가 먹이를 뜯고 있다…"); }
                float cyc = t % 7;
                bool eating = cyc < 4.4f && roarCD < 13;
                bool tearing = cyc >= 4.4f && cyc < 5.6f;
                d.SetEat(eating);
                d.bodyPitch = Mathf.Lerp(d.bodyPitch, eating ? 0.3f : 0.05f, dt * 2);
                d.extraYaw = tearing ? Mathf.Sin(t * 20) * 0.1f : 0;
                d.lookTarget = E.Cam; d.lookWeight = Mathf.MoveTowards(d.lookWeight, eating ? 0 : 1, dt * 2);
            }
        }

        void BuildFeeding()
        {
            var food = OpenSpot(T.SOf("dropBottom") + 12, -34, 20);
            WorldExtras.Clear(food, 14);
            var carcass = Add("trike");
            carcass.Place(food, 0.8f);
            carcass.frozen = true;
            carcass.transform.SetPositionAndRotation(food + Vector3.up * 0.85f, Quaternion.Euler(0, 46, 83));
            var rex = Add("rex");
            var hp = OnGround(food + new Vector3(Mathf.Sin(2.7f) * 5, 0, Mathf.Cos(2.7f) * 5));
            rex.Place(hp, Mathf.Atan2(food.x - hp.x, food.z - hp.z));
            actors.Add(new Feeder(this, rex));
            // juveniles play around their mother's kill
            for (int i = 0; i < (lowQuality ? 1 : 2); i++)
            {
                var j = Add("rex", 0.4f); j.Place(food + Vector3.right * 4, 0);
                int idx = i; float jt = i * Mathf.PI;
                updaters.Add(dt =>
                {
                    jt += dt;
                    float a = jt * 0.9f + idx * Mathf.PI, r = 5 + Mathf.Sin(jt * 1.7f) * 1.5f;
                    j.MoveToward(food + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r), 5, dt, 6, 12);
                });
            }
            // compsognathus scavengers darting around the carcass
            for (int i = 0; i < (lowQuality ? 2 : 4); i++)
            {
                var c = Add("compy", 1f); c.Place(food + Vector3.forward * 6, 0);
                float next = 0; Vector3 tgt = food;
                updaters.Add(dt =>
                {
                    next -= dt;
                    if (next < 0) { next = 0.6f + Random.value * 1.6f; float a = Random.value * Mathf.PI * 2, r = 4 + Random.value * 5; tgt = food + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r); }
                    c.MoveToward(tgt, 4.5f, dt, 6, 12);
                    c.SetEat(c.speed < 0.5f);
                });
            }
        }

        // a Carnotaurus chasing a fleeing parasaurolophus herd around a meadow
        void BuildHunt()
        {
            const float R = 30;
            Vector3? center = null;
            var cands = new[] { (T.SOf("lift2Top"), 80f), (T.SOf("hill"), 85f), (T.SOf("trike") - 30, 70f), (T.SOf("rexValley") + 40, -80f) };
            foreach (var (sc, lat) in cands)
            {
                foreach (float k in new[] { 1f, -1f })
                {
                    var c = Beside(sc, lat * k);
                    bool ok = c.y > 1.5f;
                    for (float a = 0; a < 6.28f && ok; a += 0.4f)
                    {
                        var p = c + new Vector3(Mathf.Cos(a) * R, 0, Mathf.Sin(a) * R);
                        if (Ground(p) < 1.2f || T.DistanceXZ(p) < 14 || Mathf.Abs(Ground(p) - c.y) > 9) ok = false;
                    }
                    if (ok) { center = c; break; }
                }
                if (center.HasValue) break;
            }
            if (!center.HasValue) return;
            var C = center.Value;
            WorldExtras.Clear(C, R + 8);
            var prey = new System.Collections.Generic.List<DinoActor>();
            for (int i = 0; i < (lowQuality ? 3 : 4); i++) prey.Add(Add("parasaur", 0.85f + (i % 2) * 0.1f));
            var pred = Add("carno");
            float ang = 0, ht = 0, callT = 3; bool roared = false;
            var offs = new float[prey.Count];
            for (int i = 0; i < offs.Length; i++) offs[i] = 0.22f * i;
            System.Action<DinoActor, float, float, float, float> run = (dd, a, dr, spd, dt) =>
                dd.MoveToward(C + new Vector3(Mathf.Cos(a) * (R + dr), 0, Mathf.Sin(a) * (R + dr)), spd, dt, 4, 10);
            updaters.Add(dt =>
            {
                ht += dt; ang += dt * 9.5f / R;
                for (int i = 0; i < prey.Count; i++) run(prey[i], ang + offs[i] + 0.25f, Mathf.Sin(ht * 0.7f + i) * 2, 11, dt);
                float gap = 0.28f + Mathf.Sin(ht * 0.45f) * 0.16f;
                run(pred, ang - gap + 0.25f, 0, 12, dt);
                bool near = gap < 0.17f;
                if (near) pred.Trigger("Attack");
                pred.lookTarget = prey[0].pos; pred.lookWeight = 0.6f;
                float dist = Vector3.Distance(pred.pos, Cam);
                if (near && !roared && dist < 160) { roared = true; Roar(pred); if (dist < 110) Say("카르노타우루스가 사냥 중이다!"); }
                if (!near) roared = false;
                callT -= dt;
                if (callT < 0 && dist < 150) { callT = 2.5f + Random.value * 3; if (audioDir) audioDir.Bellow(prey[0].HeadPos, 2.2f); }
            });
        }
    }
}
