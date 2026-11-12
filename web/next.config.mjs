/** @type {import('next').NextConfig} */
const nextConfig = {
  // The pricing library and the committed fixture live above web/, and are shared with
  // the agents and the simulation. One definition, three callers.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  typedRoutes: false,
};

export default nextConfig;
