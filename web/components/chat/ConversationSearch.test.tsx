import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationSearchBody } from "./ConversationSearch";
import { Dialog } from "@/components/ui/Dialog";

test("renders a searchable conversation dialog", () => {
  const markup = renderToStaticMarkup(
    <Dialog open>
      <ConversationSearchBody
        query="conflict"
        onSelect={() => {}}
        results={[
          {
            conversationId: "c1",
            conversationTitle: "Databases",
            messageId: "m1",
            match: "message",
            snippet: "Conflict serializability uses a precedence graph.",
          },
        ]}
      />
    </Dialog>,
  );

  assert.match(markup, /Search conversations/);
  assert.match(markup, /Search titles and messages/);
  assert.match(markup, /Databases/);
  assert.match(markup, /Conflict serializability/);
});
