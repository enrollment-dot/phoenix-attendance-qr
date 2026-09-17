// Lock synchronously: decoders may deliver more frames while the camera stops.
export function scanHandler(parse, stop, navigate, onError) {
  let accepted = false;
  return async (value) => {
    if (accepted) return;
    accepted = true;
    try {
      const hash = parse(value);
      await stop();
      navigate(hash);
    } catch (error) {
      accepted = false;
      onError(error);
    }
  };
}
