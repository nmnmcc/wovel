{
  pkgs,
  multiverse,
  ...
}:

{
  devenv.warnOnNewVersion = false;

  tasks."dev:install".exec = "pnpm install --frozen-lockfile";

  processes = {
    starter = {
      after = [ "dev:install" ];
      exec = ''
        set -eu
        pnpm --filter-prod @wovel/example-starter... build
        exec pnpm --filter @wovel/example-starter dev
      '';
    };
  };

  # The browser tests of @wovel/web use the Chromium that nixpkgs builds for
  # Playwright. A browser that Playwright downloads does not run on NixOS. The
  # npm `playwright` version must match `playwright-driver.version`.
  env = {
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  };

  packages = with pkgs; [
    git
    gh
    corepack
    ripgrep
  ];

  languages = {
    javascript = {
      enable = true;
      lsp.enable = false;
      package = multiverse.nodejs_26."26.6.0";
    };
  };

  treefmt = {
    enable = true;
    config = {
      projectRootFile = "devenv.nix";
      programs = {
        prettier.enable = true;
        nixfmt.enable = true;
      };
    };
  };
}
