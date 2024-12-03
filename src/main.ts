import {
    generateShortCode,
    getClickEvent,
    getShortLink,
    getUserLinks,
    incrementClickCount,
    storeShortLink,
    watchShortLink,
} from "./db.ts";
import { Router } from "./router.ts";
import { render } from "npm:preact-render-to-string";
import { createGitHubOAuthConfig, createHelpers } from "jsr:@deno/kv-oauth";
import { handleGithubCallback } from "./auth.ts";
import {
    CreateShortlinkPage,
    HomePage,
    LinksPage,
    NotFoundPage,
    ShortlinkViewPage,
    UnauthorizedPage,
} from "./ui.tsx";
import { serveDir } from "@std/http";

const app = new Router();

const oauthConfig = createGitHubOAuthConfig({
    redirectUri: Deno.env.get("REDIRECT_URI"),
});
const { signIn, signOut } = createHelpers(oauthConfig);

app.get("/oauth/signin", (req: Request) => signIn(req));
app.get("/oauth/signout", signOut);
app.get("/oauth/callback", handleGithubCallback);

function unauthorizedResponse() {
    return new Response(render(UnauthorizedPage()), {
        status: 401,
        headers: {
            "content-type": "text/html",
        },
    });
}

app.get("/", () => {
    return new Response(render(HomePage({ user: app.currentUser })), {
        status: 200,
        headers: {
            "content-type": "text/html",
        },
    });
});

app.get("/links/new", (_req) => {
    if (!app.currentUser) return unauthorizedResponse();

    return new Response(render(CreateShortlinkPage()), {
        status: 200,
        headers: {
            "content-type": "text/html",
        },
    });
});

app.get("/links/:id", async (_req, _info, params) => {
    const shortCode = params.pathname.groups["id"];
    const shortLink = await getShortLink(shortCode);

    return new Response(render(ShortlinkViewPage({ shortLink })), {
        status: 200,
        headers: {
            "content-type": "text/html",
        },
    });
});

app.get("/links", async () => {
    if (!app.currentUser) return unauthorizedResponse();

    const shortLinks = await getUserLinks(app.currentUser.login);

    return new Response(render(LinksPage({ shortLinkList: shortLinks })), {
        status: 200,
        headers: {
            "content-type": "text/html",
        },
    });
});

app.post("/links", async (req) => {
    if (!app.currentUser) return unauthorizedResponse();
    // Uses HTML Forms with HTTP Requests, faster than framework
    const formData = await req.formData();
    const longUrl = formData.get("longUrl") as string;

    if (!longUrl) {
        return new Response("Missing longUrl", { status: 400 });
    }

    const shortCode = await generateShortCode(longUrl);
    await storeShortLink(longUrl, shortCode, app.currentUser.login);
    return new Response(null, {
        status: 303,
        headers: {
            Location: "/links", //callback
        },
    });
});

app.get("/links/:id", async (_req, _info, params) => {
    if (!app.currentUser) return unauthorizedResponse();

    const shortCode = params?.pathname.groups["id"]; //hmmm make it optional? null seems shady
    const shortLink = await getShortLink(shortCode!);

    return new Response(render(ShortlinkViewPage({ shortLink })), {
        status: 200,
        headers: {
            "content-type": "text/html",
        },
    });
});

app.get("/realtime/:id", (_req, _info, params) => {
    if (!app.currentUser) return unauthorizedResponse();
    const shortCode = params?.pathname.groups["id"];

    const stream = watchShortLink(shortCode!);

    const body = new ReadableStream({
        async start(controller) {
            while (true) {
                const { done } = await stream.read();
                if (done) {
                    return;
                }

                const shortLink = await getShortLink(shortCode);
                const clickAnalytics =
                    shortLink.clickCount > 0 &&
                    (await getClickEvent(shortCode, shortLink.clickCount));

                controller.enqueue(
                    new TextEncoder().encode(
                        `data: ${JSON.stringify({
                            clickCount: shortLink.clickCount,
                            clickAnalytics,
                        })}\n\n`
                    )
                );
                console.log("Stream updated");
            }
        },
        cancel() {
            stream.cancel();
        },
    });

    return new Response(body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
});

app.get("/:id", async (req, _info, params) => {
    const shortCode = params.pathname.groups["id"];
    const shortLink = await getShortLink(shortCode);

    if (shortLink) {
        const ipAddress =
            req.headers.get("x-forwarded-for") ||
            req.headers.get("cf-connecting-ip") ||
            "Unknown";
        const userAgent = req.headers.get("user-agent") || "Unknown";
        const country = req.headers.get("cf-ipcountry") || "Unknown";

        await incrementClickCount(shortCode, {
            ipAddress,
            userAgent,
            country,
        });
        return new Response(null, {
            status: 303,
            headers: {
                Location: shortLink.longUrl,
            },
        });
    } else {
        return new Response(render(NotFoundPage({ shortCode })), {
            status: 404,
            headers: {
                "Content-Type": "text/html",
            },
        });
    }
});

app.get("/static/*", (req) => serveDir(req));

export default {
    fetch(req) {
        return app.handler(req);
    },
} satisfies Deno.ServeDefaultExport;
