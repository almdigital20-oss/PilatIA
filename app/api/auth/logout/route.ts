import { NextResponse } from "next/server";
import { clearSessionCookies } from "../../../lib/session";
export async function POST(){return clearSessionCookies(NextResponse.json({ok:true}));}
