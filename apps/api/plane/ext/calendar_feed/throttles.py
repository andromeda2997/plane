# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Throttling für den öffentlichen Feed-Endpunkt.

Pro Token statt pro IP: Outlook/Microsoft 365 ruft Abos von wenigen, geteilten
Microsoft-Adressen ab, und hinter dem Proxy sehen ohnehin viele Clients gleich
aus. Die IP-Grenze ist nur ein großzügiger Schutz gegen Durchprobieren.
Die Raten sind per Umgebungsvariable einstellbar (DRF-Format, z. B. "60/hour").
"""

import os

from rest_framework.throttling import SimpleRateThrottle

from .models import hash_token


class CalendarFeedTokenThrottle(SimpleRateThrottle):
    scope = "ext_calendar_feed_token"
    rate = os.environ.get("CALENDAR_FEED_RATE_LIMIT", "60/hour")

    def get_cache_key(self, request, view):
        token = view.kwargs.get("token")
        if not token:
            return None
        # Nie den Klartext als Cache-Schlüssel verwenden.
        return self.cache_format % {"scope": self.scope, "ident": hash_token(token)}


class CalendarFeedIPThrottle(SimpleRateThrottle):
    scope = "ext_calendar_feed_ip"
    rate = os.environ.get("CALENDAR_FEED_IP_RATE_LIMIT", "300/minute")

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
