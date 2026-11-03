// Inside Discord the app is loaded with frame_id / instance_id query parameters.
const params = new URLSearchParams(window.location.search);

export const isActivity = params.has('frame_id') || params.has('instance_id');
