import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("verlopen sessies opruimen", { hours: 24 }, internal.beheer.ruimSessiesOp, {});

export default crons;
