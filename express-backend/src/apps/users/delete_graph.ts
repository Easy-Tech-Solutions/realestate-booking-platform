// Django's delete Collector graph for everything reachable from users_user
// (generated from the Django model metadata: on_delete per reverse relation).
// [related table, FK column, on_delete]

export const DELETE_GRAPH: Record<string, { pk: string; rels: [string, string, string][] }> = {
 "agents_agentapplication": {
  "pk": "id",
  "rels": [
   [
    "agents_agentprofile",
    "application_id",
    "SET_NULL"
   ]
  ]
 },
 "agents_agentcommission": {
  "pk": "id",
  "rels": []
 },
 "agents_agentprofile": {
  "pk": "id",
  "rels": []
 },
 "authapp_socialaccount": {
  "pk": "id",
  "rels": []
 },
 "bookings_booking": {
  "pk": "id",
  "rels": [
   [
    "bookings_paymentrequest",
    "booking_id",
    "CASCADE"
   ],
   [
    "bookings_viewingappointment",
    "booking_id",
    "SET_NULL"
   ],
   [
    "payments_payment",
    "booking_id",
    "CASCADE"
   ],
   [
    "payments_payout",
    "booking_id",
    "CASCADE"
   ],
   [
    "payments_escrowhold",
    "booking_id",
    "CASCADE"
   ],
   [
    "payments_striperefund",
    "booking_id",
    "CASCADE"
   ],
   [
    "support_aircoverclaim",
    "booking_id",
    "CASCADE"
   ],
   [
    "leaseagreements_leaseagreement",
    "booking_id",
    "CASCADE"
   ],
   [
    "leaseagreements_leaseacceptance",
    "booking_id",
    "CASCADE"
   ],
   [
    "agents_agentcommission",
    "booking_id",
    "CASCADE"
   ]
  ]
 },
 "bookings_comparisonitem": {
  "pk": "id",
  "rels": []
 },
 "bookings_paymentrequest": {
  "pk": "id",
  "rels": []
 },
 "bookings_propertycomparison": {
  "pk": "id",
  "rels": [
   [
    "bookings_comparisonitem",
    "comparison_id",
    "CASCADE"
   ]
  ]
 },
 "bookings_savedsearch": {
  "pk": "id",
  "rels": [
   [
    "bookings_searchalert",
    "saved_search_id",
    "CASCADE"
   ]
  ]
 },
 "bookings_searchalert": {
  "pk": "id",
  "rels": []
 },
 "bookings_viewingappointment": {
  "pk": "id",
  "rels": [
   [
    "payments_payment",
    "viewing_id",
    "CASCADE"
   ]
  ]
 },
 "django_admin_log": {
  "pk": "id",
  "rels": []
 },
 "hostapplications_agreementacceptance": {
  "pk": "id",
  "rels": []
 },
 "hostapplications_hostapplication": {
  "pk": "id",
  "rels": []
 },
 "inventory_listingflag": {
  "pk": "id",
  "rels": []
 },
 "leaseagreements_leaseacceptance": {
  "pk": "id",
  "rels": []
 },
 "leaseagreements_leaseagreement": {
  "pk": "id",
  "rels": []
 },
 "listings_favorite": {
  "pk": "id",
  "rels": []
 },
 "listings_hotelroom": {
  "pk": "id",
  "rels": [
   [
    "listings_hotelroomimage",
    "room_id",
    "CASCADE"
   ],
   [
    "bookings_booking",
    "hotel_room_id",
    "SET_NULL"
   ]
  ]
 },
 "listings_hotelroomimage": {
  "pk": "id",
  "rels": []
 },
 "listings_listing": {
  "pk": "id",
  "rels": [
   [
    "listings_listingimage",
    "listing_id",
    "CASCADE"
   ],
   [
    "listings_favorite",
    "listing_id",
    "CASCADE"
   ],
   [
    "listings_review",
    "listing_id",
    "CASCADE"
   ],
   [
    "listings_propertyview",
    "listing_id",
    "CASCADE"
   ],
   [
    "listings_propertystats",
    "listing_id",
    "CASCADE"
   ],
   [
    "listings_hotelroom",
    "listing_id",
    "CASCADE"
   ],
   [
    "bookings_booking",
    "listing_id",
    "CASCADE"
   ],
   [
    "bookings_viewingappointment",
    "listing_id",
    "CASCADE"
   ],
   [
    "bookings_searchalert",
    "listing_id",
    "CASCADE"
   ],
   [
    "bookings_comparisonitem",
    "listing_id",
    "CASCADE"
   ],
   [
    "messaging_conversation",
    "listing_id",
    "SET_NULL"
   ],
   [
    "reports_report",
    "reported_listing_id",
    "SET_NULL"
   ],
   [
    "propertyverifications_propertyverification",
    "listing_id",
    "CASCADE"
   ],
   [
    "inventory_listingflag",
    "listing_id",
    "CASCADE"
   ],
   [
    "agents_agentcommission",
    "listing_id",
    "SET_NULL"
   ]
  ]
 },
 "listings_listingimage": {
  "pk": "id",
  "rels": []
 },
 "listings_propertystats": {
  "pk": "id",
  "rels": []
 },
 "listings_propertyview": {
  "pk": "id",
  "rels": []
 },
 "listings_review": {
  "pk": "id",
  "rels": [
   [
    "listings_reviewimage",
    "review_id",
    "CASCADE"
   ],
   [
    "reports_report",
    "reported_review_id",
    "SET_NULL"
   ]
  ]
 },
 "listings_reviewimage": {
  "pk": "id",
  "rels": []
 },
 "messaging_conversation_deleted_by": {
  "pk": "id",
  "rels": []
 },
 "messaging_conversation_participants": {
  "pk": "id",
  "rels": []
 },
 "messaging_message": {
  "pk": "id",
  "rels": [
   [
    "messaging_message",
    "reply_to_id",
    "SET_NULL"
   ],
   [
    "messaging_messageattachment",
    "message_id",
    "CASCADE"
   ],
   [
    "reports_report",
    "reported_message_id",
    "SET_NULL"
   ]
  ]
 },
 "messaging_messageattachment": {
  "pk": "id",
  "rels": []
 },
 "messaging_messageviolation": {
  "pk": "id",
  "rels": []
 },
 "notifications_devicetoken": {
  "pk": "id",
  "rels": []
 },
 "notifications_notification": {
  "pk": "id",
  "rels": []
 },
 "notifications_notificationpreference": {
  "pk": "id",
  "rels": []
 },
 "payments_escrowhold": {
  "pk": "id",
  "rels": []
 },
 "payments_payment": {
  "pk": "id",
  "rels": [
   [
    "payments_refund",
    "payment_id",
    "CASCADE"
   ]
  ]
 },
 "payments_payout": {
  "pk": "id",
  "rels": []
 },
 "payments_refund": {
  "pk": "id",
  "rels": []
 },
 "payments_savedcard": {
  "pk": "id",
  "rels": []
 },
 "payments_striperefund": {
  "pk": "id",
  "rels": []
 },
 "propertyverifications_propertyverification": {
  "pk": "id",
  "rels": []
 },
 "rbac_breakglasssession": {
  "pk": "id",
  "rels": []
 },
 "rbac_pendingapproval": {
  "pk": "id",
  "rels": []
 },
 "rbac_userroleassignment": {
  "pk": "id",
  "rels": []
 },
 "reports_report": {
  "pk": "id",
  "rels": [
   [
    "suspensions_suspension",
    "related_report_id",
    "SET_NULL"
   ]
  ]
 },
 "superadmin_impersonationsession": {
  "pk": "id",
  "rels": []
 },
 "superadmin_mfadevice": {
  "pk": "id",
  "rels": []
 },
 "superadmin_staffeducation": {
  "pk": "id",
  "rels": []
 },
 "superadmin_stafflegalrecord": {
  "pk": "id",
  "rels": []
 },
 "superadmin_staffprofile": {
  "pk": "id",
  "rels": [
   [
    "superadmin_staffeducation",
    "staff_id",
    "CASCADE"
   ],
   [
    "superadmin_stafflegalrecord",
    "staff_id",
    "CASCADE"
   ]
  ]
 },
 "support_aircoverclaim": {
  "pk": "id",
  "rels": []
 },
 "suspensions_suspension": {
  "pk": "id",
  "rels": []
 },
 "trustsafety_accountsignupevent": {
  "pk": "id",
  "rels": []
 },
 "trustsafety_fraudflag": {
  "pk": "id",
  "rels": []
 },
 "users_momochangerequest": {
  "pk": "id",
  "rels": []
 },
 "users_phonechangerequest": {
  "pk": "id",
  "rels": []
 },
 "users_profile": {
  "pk": "id",
  "rels": []
 },
 "users_user": {
  "pk": "id",
  "rels": [
   [
    "django_admin_log",
    "user_id",
    "CASCADE"
   ],
   [
    "token_blacklist_outstandingtoken",
    "user_id",
    "SET_NULL"
   ],
   [
    "authapp_socialaccount",
    "user_id",
    "CASCADE"
   ],
   [
    "listings_listing",
    "owner_id",
    "CASCADE"
   ],
   [
    "listings_listing",
    "sourced_by_agent_id",
    "SET_NULL"
   ],
   [
    "listings_listing",
    "claimed_by_user_id",
    "SET_NULL"
   ],
   [
    "listings_listing",
    "suspended_by_id",
    "SET_NULL"
   ],
   [
    "listings_favorite",
    "user_id",
    "CASCADE"
   ],
   [
    "listings_review",
    "reviewer_id",
    "CASCADE"
   ],
   [
    "listings_propertyview",
    "user_id",
    "SET_NULL"
   ],
   [
    "bookings_booking",
    "customer_id",
    "CASCADE"
   ],
   [
    "bookings_booking",
    "extended_by_id",
    "SET_NULL"
   ],
   [
    "bookings_paymentrequest",
    "created_by_id",
    "CASCADE"
   ],
   [
    "bookings_viewingappointment",
    "guest_id",
    "CASCADE"
   ],
   [
    "bookings_viewingappointment",
    "confirmed_by_id",
    "SET_NULL"
   ],
   [
    "bookings_savedsearch",
    "user_id",
    "CASCADE"
   ],
   [
    "bookings_propertycomparison",
    "user_id",
    "CASCADE"
   ],
   [
    "users_user_groups",
    "user_id",
    "CASCADE"
   ],
   [
    "users_user_user_permissions",
    "user_id",
    "CASCADE"
   ],
   [
    "users_profile",
    "user_id",
    "CASCADE"
   ],
   [
    "users_phonechangerequest",
    "user_id",
    "CASCADE"
   ],
   [
    "users_momochangerequest",
    "user_id",
    "CASCADE"
   ],
   [
    "payments_payment",
    "user_id",
    "CASCADE"
   ],
   [
    "payments_payout",
    "host_id",
    "CASCADE"
   ],
   [
    "payments_payout",
    "paid_by_id",
    "SET_NULL"
   ],
   [
    "payments_payout",
    "cancelled_by_id",
    "SET_NULL"
   ],
   [
    "payments_employeepayment",
    "paid_by_id",
    "SET_NULL"
   ],
   [
    "payments_escrowhold",
    "held_by_id",
    "SET_NULL"
   ],
   [
    "payments_escrowhold",
    "released_by_id",
    "SET_NULL"
   ],
   [
    "payments_striperefund",
    "initiated_by_id",
    "SET_NULL"
   ],
   [
    "payments_taxrate",
    "created_by_id",
    "SET_NULL"
   ],
   [
    "payments_savedcard",
    "user_id",
    "CASCADE"
   ],
   [
    "messaging_conversation_participants",
    "user_id",
    "CASCADE"
   ],
   [
    "messaging_conversation_deleted_by",
    "user_id",
    "CASCADE"
   ],
   [
    "messaging_message",
    "sender_id",
    "CASCADE"
   ],
   [
    "messaging_messageviolation",
    "sender_id",
    "CASCADE"
   ],
   [
    "messaging_messageviolation",
    "recipient_id",
    "SET_NULL"
   ],
   [
    "notifications_notification",
    "user_id",
    "CASCADE"
   ],
   [
    "notifications_notificationpreference",
    "user_id",
    "CASCADE"
   ],
   [
    "notifications_devicetoken",
    "user_id",
    "CASCADE"
   ],
   [
    "reports_report",
    "reporter_id",
    "CASCADE"
   ],
   [
    "reports_report",
    "reported_user_id",
    "SET_NULL"
   ],
   [
    "reports_report",
    "resolved_by_id",
    "SET_NULL"
   ],
   [
    "reports_report",
    "escalated_by_id",
    "SET_NULL"
   ],
   [
    "suspensions_suspension",
    "user_id",
    "CASCADE"
   ],
   [
    "suspensions_suspension",
    "issued_by_id",
    "SET_NULL"
   ],
   [
    "suspensions_suspension",
    "revoked_by_id",
    "SET_NULL"
   ],
   [
    "testimonials_testimonial",
    "user_id",
    "SET_NULL"
   ],
   [
    "support_contactinquiry",
    "user_id",
    "SET_NULL"
   ],
   [
    "support_supportticket",
    "user_id",
    "SET_NULL"
   ],
   [
    "support_supportticket",
    "assigned_to_id",
    "SET_NULL"
   ],
   [
    "support_supportticket",
    "escalated_by_id",
    "SET_NULL"
   ],
   [
    "support_ticketmessage",
    "sender_id",
    "SET_NULL"
   ],
   [
    "support_ticketattachment",
    "uploaded_by_id",
    "SET_NULL"
   ],
   [
    "support_aircoverclaim",
    "claimant_id",
    "CASCADE"
   ],
   [
    "support_aircoverclaim",
    "reviewed_by_id",
    "SET_NULL"
   ],
   [
    "hostapplications_hostapplication",
    "applicant_id",
    "CASCADE"
   ],
   [
    "hostapplications_hostapplication",
    "ps_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "hostapplications_hostapplication",
    "compliance_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "hostapplications_hostapplication",
    "supervisor_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "hostapplications_agreementacceptance",
    "user_id",
    "CASCADE"
   ],
   [
    "propertyverifications_propertyverification",
    "applicant_id",
    "CASCADE"
   ],
   [
    "propertyverifications_propertyverification",
    "ps_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "propertyverifications_propertyverification",
    "compliance_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "propertyverifications_propertyverification",
    "supervisor_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "leaseagreements_leaseacceptance",
    "user_id",
    "CASCADE"
   ],
   [
    "superadmin_adminauditlog",
    "actor_id",
    "SET_NULL"
   ],
   [
    "superadmin_mfadevice",
    "user_id",
    "CASCADE"
   ],
   [
    "superadmin_staffprofile",
    "user_id",
    "CASCADE"
   ],
   [
    "superadmin_staffprofile",
    "onboarded_by_id",
    "SET_NULL"
   ],
   [
    "superadmin_impersonationsession",
    "admin_id",
    "CASCADE"
   ],
   [
    "superadmin_impersonationsession",
    "target_id",
    "CASCADE"
   ],
   [
    "trustsafety_accountsignupevent",
    "user_id",
    "CASCADE"
   ],
   [
    "trustsafety_fraudflag",
    "user_id",
    "CASCADE"
   ],
   [
    "trustsafety_fraudflag",
    "reviewed_by_id",
    "SET_NULL"
   ],
   [
    "trustsafety_blockedfingerprint",
    "blocked_by_id",
    "SET_NULL"
   ],
   [
    "trustsafety_blacklistedlocation",
    "created_by_id",
    "SET_NULL"
   ],
   [
    "inventory_listingflag",
    "reviewed_by_id",
    "SET_NULL"
   ],
   [
    "legalops_legaldocument",
    "published_by_id",
    "SET_NULL"
   ],
   [
    "platformops_featureflag",
    "updated_by_id",
    "SET_NULL"
   ],
   [
    "rbac_role",
    "created_by_id",
    "SET_NULL"
   ],
   [
    "rbac_userroleassignment",
    "user_id",
    "CASCADE"
   ],
   [
    "rbac_userroleassignment",
    "granted_by_id",
    "SET_NULL"
   ],
   [
    "rbac_breakglasssession",
    "user_id",
    "CASCADE"
   ],
   [
    "rbac_breakglasssession",
    "revoked_by_id",
    "SET_NULL"
   ],
   [
    "rbac_pendingapproval",
    "requested_by_id",
    "CASCADE"
   ],
   [
    "rbac_pendingapproval",
    "decided_by_id",
    "SET_NULL"
   ],
   [
    "chatbot_chatsession",
    "user_id",
    "SET_NULL"
   ],
   [
    "agents_agentapplication",
    "applicant_id",
    "CASCADE"
   ],
   [
    "agents_agentapplication",
    "ps_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "agents_agentapplication",
    "compliance_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "agents_agentapplication",
    "supervisor_reviewed_by_id",
    "SET_NULL"
   ],
   [
    "agents_agentprofile",
    "user_id",
    "CASCADE"
   ],
   [
    "agents_agentcommission",
    "agent_id",
    "CASCADE"
   ],
   [
    "agents_agentcommission",
    "paid_by_id",
    "SET_NULL"
   ]
  ]
 },
 "users_user_groups": {
  "pk": "id",
  "rels": []
 },
 "users_user_user_permissions": {
  "pk": "id",
  "rels": []
 }
};
