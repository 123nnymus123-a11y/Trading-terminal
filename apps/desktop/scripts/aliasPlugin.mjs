import path from 'node:path';

export function aliasPlugin(aliases) {
  const entries = Object.entries(aliases);

  return {
    name: 'tc-alias-plugin',
    setup(build) {
      for (const [key, target] of entries) {
        // Exact match
        const exact = new RegExp(`^${escapeRegExp(key)}$`);
        build.onResolve({ filter: exact }, () => ({
          path: target,
        }));

        // Prefix match (e.g. @tc/shared/foo)
        const prefix = new RegExp(`^${escapeRegExp(key)}\\/(.+)$`);
        build.onResolve({ filter: prefix }, (args) => {
          const suffix = args.path.slice(key.length + 1);
          return {
            path: path.join(target, suffix),
          };
        });
      }
    },
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
