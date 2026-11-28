// One animal in the world. Wraps any imported model (auto-scaled to a real-world
// length and dropped onto the ground) or builds a simple placeholder if no model is set.
// Animator parameters used when present: float "Speed", triggers "Roar" / "Attack",
// bools "Eat", "TailSwing", "Swim". Missing parameters are simply ignored.
using System.Collections.Generic;
using UnityEngine;

namespace DinoRush
{
    public class DinoActor : MonoBehaviour
    {
        public string species;
        public float speed;          // m/s, drives the walk/run blend
        public float heading;        // radians, 0 = +Z
        public Vector3 pos;          // world position (feet, or body centre for swimmers)
        public float scale = 1f;
        public bool swim;
        public Vector3? lookTarget;
        public float lookWeight;
        public Transform headBone;   // optional: assign a head/neck bone for look-at
        public float roarSize = 1f, roarPitch = 1f;
        // extra pose controls (whole-body, so they also work on unrigged models)
        public float bodyPitch;      // + = nose down
        public float bodyRoll;
        public float extraYaw;       // head shake / dazed wobble
        public float crouch;         // 0..1 lowers the body (resting)
        public bool frozen;          // carcasses: keep the pose given by the director

        Animator anim;
        readonly HashSet<string> paramNames = new HashSet<string>();
        Transform model;
        float bob, modelBaseY;
        Terrain terrain;

        public static DinoActor Spawn(string species, GameObject prefab, float realLength, float realHeight, Color placeholderColor, float scale, Terrain terrain, Transform parent, float yawOffsetDeg = 0f, bool swim = false)
        {
            var root = new GameObject(species);
            if (parent) root.transform.SetParent(parent, false);
            var a = root.AddComponent<DinoActor>();
            a.species = species; a.scale = scale; a.terrain = terrain; a.swim = swim;
            GameObject m;
            if (prefab)
            {
                m = Instantiate(prefab, root.transform);
                m.transform.localPosition = Vector3.zero; m.transform.localRotation = Quaternion.Euler(0, yawOffsetDeg, 0); m.transform.localScale = Vector3.one;
                var b = GetBounds(m);
                float len = Mathf.Max(b.size.x, b.size.z, 0.01f);
                m.transform.localScale = Vector3.one * (realLength * scale / len);
                b = GetBounds(m);
                // walkers stand on the ground; swimmers are centred on their position
                float y = swim ? -(b.center.y - root.transform.position.y) : -(b.min.y - root.transform.position.y);
                m.transform.localPosition = new Vector3(0, y, 0);
            }
            else m = swim ? SwimPlaceholder(realLength * scale, realHeight * scale, placeholderColor, root.transform)
                          : Placeholder(realLength * scale, realHeight * scale, placeholderColor, root.transform);
            a.model = m.transform;
            a.modelBaseY = m.transform.localPosition.y;
            a.anim = m.GetComponentInChildren<Animator>();
            if (a.anim && a.anim.runtimeAnimatorController)
                foreach (var p in a.anim.parameters) a.paramNames.Add(p.name);
            if (!a.headBone) a.headBone = FindBone(m.transform, new[] { "head", "Head", "HEAD", "skull", "Skull" });
            foreach (var r in m.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            if (swim) a.SetBool("Swim", true);
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
            var mat = MatUtil.Lit(col, 0f, 0.25f);
            float hip = height * 0.62f, bodyR = height * 0.22f;
            MatUtil.Prim(PrimitiveType.Capsule, root.transform, new Vector3(0, hip, 0), new Vector3(bodyR * 2, len * 0.32f, bodyR * 2.2f), mat, new Vector3(90, 0, 0));
            MatUtil.Prim(PrimitiveType.Capsule, root.transform, new Vector3(0, hip * 0.95f, -len * 0.35f), new Vector3(bodyR, len * 0.22f, bodyR), mat, new Vector3(100, 0, 0));
            MatUtil.Prim(PrimitiveType.Sphere, root.transform, new Vector3(0, height * 0.9f, len * 0.32f), new Vector3(bodyR * 1.6f, bodyR * 1.4f, bodyR * 2.4f), mat);
            for (int s = -1; s <= 1; s += 2)
                MatUtil.Prim(PrimitiveType.Cylinder, root.transform, new Vector3(s * bodyR * 0.7f, hip * 0.5f, 0), new Vector3(bodyR * 0.6f, hip * 0.5f, bodyR * 0.6f), mat);
            return root;
        }

        static GameObject SwimPlaceholder(float len, float height, Color col, Transform parent)
        {
            var root = new GameObject("placeholder");
            root.transform.SetParent(parent, false);
            var mat = MatUtil.Lit(col, 0f, 0.5f);
            float r = height * 0.5f;
            MatUtil.Prim(PrimitiveType.Capsule, root.transform, Vector3.zero, new Vector3(r * 2, len * 0.5f, r * 1.8f), mat, new Vector3(90, 0, 0));
            MatUtil.Prim(PrimitiveType.Sphere, root.transform, new Vector3(0, 0, len * 0.42f), new Vector3(r * 1.3f, r * 1.1f, r * 2.4f), mat);
            foreach (int s in new[] { -1, 1 })
            {
                MatUtil.Prim(PrimitiveType.Sphere, root.transform, new Vector3(s * r * 1.6f, -r * 0.3f, len * 0.12f), new Vector3(r * 2.2f, r * 0.15f, r * 0.8f), mat, new Vector3(0, -s * 25, 0));
                MatUtil.Prim(PrimitiveType.Sphere, root.transform, new Vector3(s * r * 1.3f, -r * 0.3f, -len * 0.2f), new Vector3(r * 1.6f, r * 0.12f, r * 0.6f), mat, new Vector3(0, -s * 25, 0));
            }
            MatUtil.Prim(PrimitiveType.Cube, root.transform, new Vector3(0, 0, -len * 0.5f), new Vector3(r * 0.15f, r * 2.2f, r * 1.0f), mat);
            return root;
        }

        public void Place(Vector3 p, float h) { pos = p; heading = h; }

        public void Trigger(string name) { if (anim && paramNames.Contains(name)) anim.SetTrigger(name); }
        public void SetBool(string name, bool on) { if (anim && paramNames.Contains(name)) anim.SetBool(name, on); }
        public void SetEat(bool on) => SetBool("Eat", on);
        public void SetTailSwing(bool on) => SetBool("TailSwing", on);

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
            if (!swim) pos.y = Ground(pos);
        }

        void LateUpdate()
        {
            if (frozen) return;
            transform.SetPositionAndRotation(pos, Quaternion.Euler(bodyPitch * Mathf.Rad2Deg, (heading + extraYaw) * Mathf.Rad2Deg, bodyRoll * Mathf.Rad2Deg));
            if (anim && paramNames.Contains("Speed")) anim.SetFloat("Speed", speed / Mathf.Max(0.1f, scale));
            if (model)
            {
                float y = modelBaseY - crouch * 0.25f * scale;
                if (!anim)
                {
                    // placeholder: bob while moving (walkers) or undulate (swimmers)
                    bob += Time.deltaTime * (swim ? 2.4f : speed * 1.4f);
                    if (swim) model.localRotation = Quaternion.Euler(0, Mathf.Sin(bob) * 6f, 0);
                    else y += Mathf.Abs(Mathf.Sin(bob)) * 0.08f * scale;
                }
                model.localPosition = new Vector3(0, y, 0);
            }
            if (headBone && lookTarget.HasValue && lookWeight > 0.01f)
            {
                Vector3 to = lookTarget.Value - headBone.position;
                if (Vector3.Angle(transform.forward, to) < 100)
                {
                    var want = Quaternion.FromToRotation(headBone.forward, to.normalized) * headBone.rotation;
                    headBone.rotation = Quaternion.Slerp(headBone.rotation, want, lookWeight * 0.6f);
                }
            }
        }

        public Vector3 HeadPos => headBone ? headBone.position : transform.position + transform.up * 3f * scale * (swim ? 0.2f : 1f) + transform.forward * 3f * scale;
    }
}
