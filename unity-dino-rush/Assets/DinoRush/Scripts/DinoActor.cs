// One dinosaur in the world. Wraps any imported model (auto-scaled to a real-world
// length and dropped onto the ground) or builds a simple placeholder if no model is set.
// Animator parameters used when present: float "Speed", triggers "Roar" / "Attack",
// bool "Eat". Missing parameters are simply ignored.
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public class DinoActor : MonoBehaviour
    {
        public string species;
        public float speed;          // m/s, drives the walk/run blend
        public float heading;        // radians, 0 = +Z
        public Vector3 pos;          // ground position
        public float scale = 1f;
        public Vector3? lookTarget;
        public float lookWeight;
        public Transform headBone;   // optional: assign a head/neck bone for look-at
        public float roarSize = 1f, roarPitch = 1f;

        Animator anim;
        readonly HashSet<string> paramNames = new HashSet<string>();
        Transform model;
        float bob;
        Terrain terrain;

        public static DinoActor Spawn(string species, GameObject prefab, float realLength, float realHeight, Color placeholderColor, float scale, Terrain terrain, Transform parent, float yawOffsetDeg = 0f)
        {
            var root = new GameObject(species);
            if (parent) root.transform.SetParent(parent, false);
            var a = root.AddComponent<DinoActor>();
            a.species = species; a.scale = scale; a.terrain = terrain;
            GameObject m;
            if (prefab)
            {
                m = Instantiate(prefab, root.transform);
                m.transform.localPosition = Vector3.zero; m.transform.localRotation = Quaternion.Euler(0, yawOffsetDeg, 0); m.transform.localScale = Vector3.one;
                // normalise any asset to the species' real length and stand it on the ground
                var b = GetBounds(m);
                float len = Mathf.Max(b.size.x, b.size.z, 0.01f);
                float k = realLength * scale / len;
                m.transform.localScale = Vector3.one * k;
                b = GetBounds(m);
                m.transform.localPosition = new Vector3(0, -(b.min.y - root.transform.position.y), 0);
            }
            else m = Placeholder(realLength * scale, realHeight * scale, placeholderColor, root.transform);
            a.model = m.transform;
            a.anim = m.GetComponentInChildren<Animator>();
            if (a.anim && a.anim.runtimeAnimatorController)
                foreach (var p in a.anim.parameters) a.paramNames.Add(p.name);
            if (!a.headBone) a.headBone = FindBone(m.transform, new[] { "head", "Head", "HEAD", "skull", "Skull" });
            foreach (var r in m.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            return a;
        }

        static Bounds GetBounds(GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return new Bounds(go.transform.position, Vector3.one);
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b;
        }

        static Transform FindBone(Transform t, string[] keys)
        {
            foreach (var k in keys) if (t.name.Contains(k)) return t;
            foreach (Transform c in t) { var f = FindBone(c, keys); if (f) return f; }
            return null;
        }

        // simple stand-in dinosaur made of primitives (until a real model is assigned)
        static GameObject Placeholder(float len, float height, Color col, Transform parent)
        {
            var root = new GameObject("placeholder");
            root.transform.SetParent(parent, false);
            var mat = TrackMeshBuilder.MakeMat(col, 0f, 0.25f);
            GameObject Prim(PrimitiveType t, Vector3 p, Vector3 s, Vector3 e)
            {
                var g = GameObject.CreatePrimitive(t);
                Object.Destroy(g.GetComponent<Collider>());
                g.transform.SetParent(root.transform, false);
                g.transform.localPosition = p; g.transform.localScale = s; g.transform.localEulerAngles = e;
                g.GetComponent<Renderer>().sharedMaterial = mat;
                return g;
            }
            float hip = height * 0.62f, bodyR = height * 0.22f;
            Prim(PrimitiveType.Capsule, new Vector3(0, hip, 0), new Vector3(bodyR * 2, len * 0.32f, bodyR * 2.2f), new Vector3(90, 0, 0));
            Prim(PrimitiveType.Capsule, new Vector3(0, hip * 0.95f, -len * 0.35f), new Vector3(bodyR, len * 0.22f, bodyR), new Vector3(100, 0, 0)); // tail
            Prim(PrimitiveType.Sphere, new Vector3(0, height * 0.9f, len * 0.32f), new Vector3(bodyR * 1.6f, bodyR * 1.4f, bodyR * 2.4f), Vector3.zero); // head
            for (int s = -1; s <= 1; s += 2)
                Prim(PrimitiveType.Cylinder, new Vector3(s * bodyR * 0.7f, hip * 0.5f, 0), new Vector3(bodyR * 0.6f, hip * 0.5f, bodyR * 0.6f), Vector3.zero);
            return root;
        }

        public void Place(Vector3 p, float h) { pos = p; heading = h; }

        public void Trigger(string name) { if (anim && paramNames.Contains(name)) anim.SetTrigger(name); }
        public void SetEat(bool on) { if (anim && paramNames.Contains("Eat")) anim.SetBool("Eat", on); }

        public float Ground(Vector3 p) => terrain ? terrain.SampleHeight(p) + terrain.transform.position.y : 0f;

        public void MoveToward(Vector3 target, float maxSpeed, float dt, float turnRate = 2.5f, float accel = 8f)
        {
            float dx = target.x - pos.x, dz = target.z - pos.z;
            float dist = Mathf.Sqrt(dx * dx + dz * dz);
            float want = Mathf.Min(maxSpeed, dist * 1.5f);
            speed += Mathf.Clamp(want - speed, -accel * dt * 2, accel * dt);
            if (dist > 0.05f) heading = Mathf.LerpAngle(heading * Mathf.Rad2Deg, Mathf.Atan2(dx, dz) * Mathf.Rad2Deg, Mathf.Min(1, turnRate * dt)) * Mathf.Deg2Rad;
            float step = Mathf.Min(speed * dt, dist);
            pos.x += Mathf.Sin(heading) * step;
            pos.z += Mathf.Cos(heading) * step;
            pos.y = Ground(pos);
        }

        void LateUpdate()
        {
            transform.SetPositionAndRotation(pos, Quaternion.Euler(0, heading * Mathf.Rad2Deg, 0));
            if (anim && paramNames.Contains("Speed")) anim.SetFloat("Speed", speed / Mathf.Max(0.1f, scale));
            else if (!anim && model)
            {
                // placeholder: bob while moving
                bob += speed * Time.deltaTime * 1.4f;
                model.localPosition = new Vector3(0, Mathf.Abs(Mathf.Sin(bob)) * 0.08f * scale, 0);
            }
            if (headBone && lookTarget.HasValue && lookWeight > 0.01f)
            {
                // turn the head toward the target after animation has posed it
                Vector3 to = lookTarget.Value - headBone.position;
                Vector3 fwd = transform.forward;
                float ang = Vector3.Angle(fwd, to);
                if (ang < 100)
                {
                    var want = Quaternion.FromToRotation(headBone.forward, to.normalized) * headBone.rotation;
                    headBone.rotation = Quaternion.Slerp(headBone.rotation, want, lookWeight * 0.6f);
                }
            }
        }

        public Vector3 HeadPos => headBone ? headBone.position : transform.position + Vector3.up * 3f * scale + transform.forward * 3f * scale;
    }
}
