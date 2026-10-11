import engineering from "../../../../teams/engineering/team.json";
import marketing from "../../../../teams/100x-marketing/team.json";
import followUp from "../../../../teams/inbox-follow-up/team.json";
import seo from "../../../../teams/seo-growth/team.json";

export interface TeamTemplate {
  format: string;
  version: number;
  team: {
    name: string;
    description: string;
    members: { key: string; name: string; title: string; description: string }[];
    room: { bulletin: string; defaultResponder: { kind: string; member: string } };
  };
}

export const teamTemplates: TeamTemplate[] = [
  engineering,
  marketing,
  followUp,
  seo,
];
