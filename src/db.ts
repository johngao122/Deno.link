import { encodeBase64Url } from "jsr:@std/encoding";
import { crypto } from "jsr:@std/crypto/crypto";

export type ShortLink = {
    shortCode: string;
    longUrl: string;
    createdAt: number;
    userId: string;
    clickCount: number;
    lastClickEvent?: string;
};

export type GitHubUser = {
    login: string;
    avatar_url: string;
    html_url: string;
};

export type ClickAnalytics = {
    shortUrl: string;
    createdAt: number;
    ipAddress: string;
    userAgent: string;
    country?: string;
};

export async function generateShortCode(longUrl: string) {
    try {
        new URL(longUrl);
    } catch (error) {
        console.log(error);
        throw new Error("Invalid URL provided");
    }

    const urlData = new TextEncoder().encode(longUrl + Date.now());
    const hash = await crypto.subtle.digest("SHA-256", urlData);

    const shortCode = encodeBase64Url(hash.slice(0, 8));

    return shortCode;
}

const kv = await Deno.openKv();

export async function storeShortLink(
    longUrl: string,
    shortCode: string,
    userId: string
) {
    const shortLinkKey = ["shortlinks", shortCode];
    const data: ShortLink = {
        shortCode,
        longUrl,
        userId,
        createdAt: Date.now(),
        clickCount: 0,
    };

    const userKey = [userId, shortCode];

    const res = await kv
        .atomic()
        .set(shortLinkKey, data)
        .set(userKey, shortCode)
        .commit();

    return res;
}

export async function getShortLink(shortCode: string) {
    const link = await kv.get<ShortLink>(["shortlinks", shortCode]);
    return link.value;
}

export async function getAllLinks() {
    const list = kv.list<ShortLink>({ prefix: ["shortlinks"] });
    const res = await Array.fromAsync(list);
    const linkValues = res.map((v) => v.value);
    return linkValues;
}

export async function storeUser(sessionId: string, userData: GitHubUser) {
    const key = ["sessions", sessionId];
    const res = await kv.set(key, userData);
    return res;
}

export async function getUser(sessionId: string) {
    const key = ["sessions", sessionId];
    const res = await kv.get<GitHubUser>(key);
    return res.value;
}

export async function getUserLinks(userId: string) {
    const list = kv.list<string>({ prefix: [userId] });
    const res = await Array.fromAsync(list);
    const userShortLinkKeys = res.map((v) => ["shortlinks", v.value]);

    const userRes = await kv.getMany<ShortLink[]>(userShortLinkKeys);
    const userShortLinks = await Array.fromAsync(userRes);

    return userShortLinks.map((v) => v.value); //TODO: Implement null checks
}

export function watchShortLink(shortCode: string) {
    const shortLinkKey = ["shortlinks", shortCode];
    const shortLinkStream = kv.watch<ShortLink[]>([shortLinkKey]).getReader();
    return shortLinkStream;
}

export async function getClickEvent(shortCode: string, clickId: number) {
    const analytics = await kv.get<ClickAnalytics>([
        "analytics",
        shortCode,
        clickId,
    ]);
    return analytics.value;
}

export async function incrementClickCount(
    shortCode: string,
    data?: Partial<ClickAnalytics>
) {
    const shortLinkKey = ["shortlinks", shortCode];
    const shortLink = await kv.get(shortLinkKey);
    const shortLinkData = shortLink.value as ShortLink;

    const newClickCount = shortLinkData?.clickCount + 1;

    const analyicsKey = ["analytics", shortCode, newClickCount];
    const analyticsData = {
        shortCode,
        createdAt: Date.now(),
        ...data, //Browser specific params
    };

    const res = await kv
        .atomic()
        .check(shortLink)
        .set(shortLinkKey, {
            ...shortLinkData,
            clickCount: newClickCount,
        })
        .set(analyicsKey, analyticsData)
        .commit();

    if (!res.ok) {
        console.error("Click not recorded");
    }

    return res;
}
