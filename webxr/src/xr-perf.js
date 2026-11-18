// Hand-tracking without per-frame garbage.
//
// three.js reads hand joints with one frame.getJointPose() call per joint: 2 hands x 25
// joints, each returning new XRJointPose / XRRigidTransform / Float32Array objects, every
// frame. The garbage collector then pauses now and then, which shows up as stutter.
// Babylon.js measured fewer >30 ms frames on Spectacles after moving to the batched API.
//
// This patch answers getJointPose() from one frame.fillPoses() call per hand per frame,
// into preallocated arrays and reused pose objects. Runtimes without fillPoses keep the
// original behaviour.
export function batchJointPoses() {
  const proto = globalThis.XRFrame?.prototype;
  if (!proto || typeof proto.fillPoses !== 'function' || typeof proto.fillJointRadii !== 'function') return false;
  if (proto.__batchedJoints) return true;
  const original = proto.getJointPose;
  const handOf = new WeakMap(); // XRJointSpace -> { state, index }
  const states = new WeakMap(); // XRHand -> state

  const stateFor = (hand) => {
    let s = states.get(hand);
    if (s) return s;
    const spaces = [...hand.values()];
    const n = spaces.length;
    const poses = new Float32Array(16 * n);
    const radii = new Float32Array(n);
    s = {
      spaces, poses, radii, frame: null, base: null, ok: false,
      // reused result objects; three.js copies the values out right away
      results: spaces.map((_, i) => ({ transform: { matrix: poses.subarray(16 * i, 16 * i + 16) }, radius: 0 })),
    };
    spaces.forEach((space, index) => handOf.set(space, { state: s, index }));
    states.set(hand, s);
    return s;
  };

  proto.getJointPose = function getJointPose(joint, baseSpace) {
    let entry = handOf.get(joint);
    if (!entry) {
      for (const source of this.session.inputSources) if (source.hand) stateFor(source.hand);
      entry = handOf.get(joint);
      if (!entry) return original.call(this, joint, baseSpace);
    }
    const s = entry.state;
    if (s.frame !== this || s.base !== baseSpace) {
      s.frame = this;
      s.base = baseSpace;
      try {
        s.ok = this.fillPoses(s.spaces, baseSpace, s.poses) && this.fillJointRadii(s.spaces, s.radii);
      } catch {
        s.ok = false;
      }
    }
    if (!s.ok) return original.call(this, joint, baseSpace);
    const r = s.results[entry.index];
    r.radius = s.radii[entry.index];
    return r;
  };
  proto.__batchedJoints = true;
  return true;
}
